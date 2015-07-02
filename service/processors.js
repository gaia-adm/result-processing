/**
 * Responsible for discovery of result processors and result processor execution.
 * @module service/processors
 */
'use strict';

var log4js = require('log4js');
var fs = require('fs');
var path = require('path');
var async = require("async");
var childProcess = require('child_process');
var VError = require('verror');
var makeSource  = require('stream-json');
var StreamArray = require('stream-json/utils/StreamArray');
var events = require('events');
var util = require('util');

var logger = log4js.getLogger('processors.js');

// map of 'metric/category' key to processor descriptor
var processorsMap = {};

/**
 * Verifies processor at given path with given descriptor. Performs verification of the descriptor and test execution of
 * the processor.
 *
 * @param path directory where the result processor is located
 * @param desc descriptor of result processor
 * @param callback
 */
function verifyProcessor(path, desc, callback) {
    // verify required properties
    if (desc.name === undefined) {
        callback(new Error('Result processor ' + path + ' doesn\'t have name defined'));
        return;
    }
    if (desc.command === undefined) {
        callback(new Error('Result processor ' + path + ' doesn\'t have command defined'));
        return;
    }
    if (desc.consumes === undefined) {
        callback(new Error('Result processor ' + path + ' doesn\'t have consumes defined'));
        return;
    }
    if (!Array.isArray(desc.consumes)) {
        callback(new Error('Result processor ' + path + ' consumes key must contain an array'));
        return;
    }
    // verify that command script works
    var child = childProcess.exec(desc.command, {cwd: desc.path}, function (err, stdout, stderr) {
        if (err) {
            logger.error('Unexpected return code ' + err.code + ' while executing result processor ' + path);
            logger.error(stderr);
            callback(new Error('Result processor ' + path + ' execution failed with ' + err.code));
            return;
        } else {
            // test execution worked
            callback();
        }
    });
    child.stdin.end();
}

/**
 * Performs result processor discovery at given processorPath. If the path represents a result processor, its descriptor
 * will be read and added to processorDescs.
 *
 * @param processorDescs array of processor descriptors where new descriptor will be added
 * @param processorPath path (file/directory) being scanned
 * @param callback
 */
function discoverProcessor(processorDescs, processorPath, callback) {
    try {
        var stat = fs.lstatSync(processorPath);
        if (stat.isDirectory()) {
            // check if it has processor-descriptor.json
            var descPath = path.join(processorPath, 'processor-descriptor.json');
            if (fs.existsSync(descPath)) {
                try {
                    fs.accessSync(descPath, fs.R_OK);
                } catch (err) {
                    logger.error(err.stack);
                    throw new VError(err, 'Unable to read ' + descPath);
                }
                var content = fs.readFileSync(descPath).toString();
                var desc = JSON.parse(content);
                desc.path = processorPath;
                verifyProcessor(processorPath, desc, function(err) {
                    if (err) {
                        logger.error('Verification of processor ' + desc.name + ' failed with error ', err);
                    } else {
                        desc.logger = log4js.getLogger('processor:' + desc.name);
                        processorDescs.push(desc);
                    }
                    callback();
                });
            } else {
                callback();
            }
        } else {
            callback();
        }
    } catch (err) {
        logger.error('Error while discovering processor at ' + processorPath, err);
        callback();
    }
}

/**
 * Initializes processors service. Discovers result processors on supplied processorsPath. Processor descriptors will be
 * supplied to initCallback upon completion.
 */
function init(processorsPath, initCallback) {
    // discover processors
    var itemPaths = fs.readdirSync(processorsPath);
    var processorDescs = [];
    async.each(itemPaths, function(itemPath, callback) {
        discoverProcessor(processorDescs, path.join(processorsPath, itemPath), callback);
    }, function(err) {
        if (err) {
            initCallback(err);
        } else {
            initProcessorsMap(processorDescs);
            initCallback(null, processorDescs);
        }
    });
}

function initProcessorsMap(processorDescs) {
    processorsMap = {};
    processorDescs.forEach(function(processorDesc) {
        var consumesArr = processorDesc.consumes;
        consumesArr.forEach(function(consumesItem) {
            var key = getProcessorsMapKey(consumesItem);
            processorsMap[key] = processorDesc;
        });
    });
}

function getProcessorsMapKey(consumesItem) {
    return consumesItem.metric + '/' + consumesItem.category;
}

/**
 * To be invoked when a child result executor tries to log something.
 *
 * @param processorDesc descriptor of result processor
 * @param str string to be logged
 */
function onLogFromChild(processorDesc, str) {
    var logRecords = str.split(/\r?\n/);
    logRecords.forEach(function(logRecord) {
        if (logRecord.length > 0) {
            processorDesc.logger.info(logRecord);
        }
    });
}

/**
 * Converts file descriptor properties to environment variables object that can be used for process execution. We use
 * environment variables instead of process arguments since for program it may not be easy to read the arguments
 * for example in case of Java - one has to use -D to pass arguments to Java app. Its much easier to access process
 * environment variables. Environment variables will be prefixed with p_. String case is preserved.
 *
 * @param fileDescriptor
 */
function toEnvParams(fileDescriptor) {
    var ignored = {path: true, authorization: true};
    var envParams = {};
    var keys = Object.keys(fileDescriptor);
    for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        if (!ignored[key]) {
            envParams['p_' + key] = fileDescriptor[key];
        }
    }
    return envParams;
}

/**
 * Executes result processor identified by processorDesc on file identified by fileDescriptor. Processor will receive the
 * file on stdin and is expected to provide result in the form of JSON on stdout. The expected result is JSON array of
 * JSON objects.
 *
 * @param processorDesc result processor descriptor
 * @param fileDescriptor descriptor of file - contains path, contentType, metric, category, name etc.
 * @returns {ProcessingNotifier} which allows caller to receive processed data, be informed about end or error
 */
function executeProcessor(processorDesc, fileDescriptor) {
    logger.debug('Executing processor ' + processorDesc.name);
    var readStream = fs.createReadStream(fileDescriptor.path);
    var envParams = toEnvParams(fileDescriptor);
    var child = childProcess.exec(processorDesc.command, {cwd: processorDesc.path, env: envParams}, function (err) {
        readStream.destroy();
        cleanup();
        if (err) {
            logger.debug('Execution of processor failed ', err);
        } else {
            logger.debug('Processor exited');
        }
    });
    var notifier = new ProcessingNotifier(processorDesc, child);

    // log child stderr as info
    var childErrStream = child.stderr;
    childErrStream.setEncoding('utf8');
    function onStdErrData(str) {
        onLogFromChild(processorDesc, str);
    }
    childErrStream.on('data', onStdErrData);

    // parse JSON output on stdout
    var objectStream = StreamArray.make();
    function onObjectStreamData(object) {
        notifier._emitData(object.value);
    }
    objectStream.output.on('data', onObjectStreamData);
    function onParserError(err) {
        notifier._emitError(new VError(err, 'Parsing error when parsing response from \'' + processorDesc.name + '\''));
        // stop the process, since we cannot parse the result
        notifier.stop();
    }
    objectStream.streams[0].on('error', onParserError);
    child.stdout.setEncoding('utf8');
    child.stdout.pipe(objectStream.input);

    // child process input is the stream
    readStream.pipe(child.stdin);

    // cleanup
    function cleanup() {
        childErrStream.removeListener('data', onStdErrData);
        objectStream.output.removeListener('data', onObjectStreamData);
        objectStream.streams[0].removeListener('error', onParserError);
    }

    return notifier;
}

/**
 * Processes a file using one of registered result processors.
 *
 * @param fileDescriptor describes file - contains path, contentType, metric, category, name etc.
 * @returns {ProcessingNotifier} which allows caller to receive processed data, be informed about end or error
 */
function processFile(fileDescriptor) {
    // check if we actually support it
    var key = getProcessorsMapKey(fileDescriptor);
    var processorDesc = processorsMap[key];
    if (processorDesc) {
        return executeProcessor(processorDesc, fileDescriptor);
    } else {
        throw new Error('Unsupported content ' + key);
    }
}

/**
 * Class responsible for notification of caller with JSON data returned by result processor. This class extends EventEmitter.
 * 'data' event will be emitted whenever JSON object is sent by result processor. Receiver may choose to receive several
 * objects before sending them in bulk for efficiency reasons. Listener function will receive an object parameter.
 * 'end' event will be emitted when no more data is to be expected. If process startup failed, process exited with non 0
 * code or exited with 0 but there was a previous error there will be an error argument. In such case the operation is
 * not to be considered success.
 * 'error' event will be emitted if there was parsing error of result processor result. No more data events will be emitted.
 *
 * @param processorDesc result processor descriptor
 * @param child result processor process
 * @constructor
 */
function ProcessingNotifier(processorDesc, child) {
    this.processorDesc = processorDesc;
    this.child = child;
    this.stopRequested = false;
    this.exited = false;
    this.hasError = false;
    var that = this;

    events.EventEmitter.call(this);

    function onProcessExit(code) {
        that.exited = true;
        cleanup();
        if (that.stopRequested) {
            that.hasError = true;
            var err = new Error('Result processor \'' + that.processorDesc.name + '\' was requested to stop and exited with ' + code);
            err.code = code;
            that.emit('end', err);
        } else if (that.hasError) {
            that.hasError = true;
            var err = new Error('Result processing of \'' + that.processorDesc.name + '\' had a previous error, process exited with ' + code);
            err.code = code;
            that.emit('end', err);
        } else if (code !== 0) {
            that.hasError = true;
            var err = new Error('Result processor \'' + that.processorDesc.name + '\' exited with ' + code);
            err.code = code;
            that.emit('end', err);
        } else {
            that.emit('end');
        }
    }
    function onProcessError(err) {
        that.exited = true;
        that.hasError = true;
        cleanup();
        that.emit('end', err);
    }
    function cleanup() {
        child.removeListener('exit', onProcessExit);
        child.removeListener('error', onProcessError);
    }

    child.on('exit', onProcessExit);
    child.on('error', onProcessError);
}

util.inherits(ProcessingNotifier, events.EventEmitter);

ProcessingNotifier.prototype._emitData = function(data) {
    if (!this.hasError && !this.exited && !this.stopRequested) {
        this.emit('data', data);
    }
}

ProcessingNotifier.prototype._emitError = function(err) {
    this.hasError = true;
    this.emit('error', err);
}

/**
 * Stops result processor by sending SIGTERM. To be invoked when its not meaningful to continue result processing
 * due to previous error when storing the processed data. No more data events will be emitted even if process refuses
 * to exit.
 */
ProcessingNotifier.prototype.stop = function() {
    this.stopRequested = true;
    if (!this.exited) {
        // sends SIGTERM to child process. Note that process may ignore it.
        this.child.kill();
    }
}

exports.init = init;
exports.processFile = processFile;
