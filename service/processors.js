/**
 * Responsible for discovery of result processors and result processor execution.
 * @module service/processors
 */
'use strict';

var log4js = require('log4js');
var fs = require('fs');
var path = require('path');
var async = require("async");
var nodefn = require('when/node');
var childProcess = require('child_process');
var VError = require('verror');
var WError = VError.WError;
var errorUtils = require('../util/error-utils.js');
var getFullError = errorUtils.getFullError;
var StreamArray = require('stream-json/utils/StreamArray');
var events = require('events');
var util = require('util');

var logger = log4js.getLogger('processors.js');

/**
 * Map of 'dataType' key to processor descriptor.
 */
var processorsMap = {};

/**
 * RegExp of allowed data processor STDERR format. Example: 'ERROR:HelloWorld.py:Something failed'. Format corresponds
 * to basic Python logging configuration.
 * @type {RegExp}
 */
var childLogRegExp = new RegExp('([A-Z]+):([^:]+):(.*)');

/**
 * Map of Python log levels used by child processor logger to log4js log levels.
 */
var childLogLevelMap = {'DEBUG': 'DEBUG', 'INFO': 'INFO', 'WARNING': 'WARN', 'ERROR': 'ERROR', 'CRITICAL': 'FATAL'};

/**
 * Map of log4js level strings to Python log levels used by child processor logger.
 */
var log4jsToChildLogLevelMap = {'ALL': 'DEBUG', 'TRACE': 'DEBUG', 'DEBUG': 'DEBUG', 'INFO': 'INFO', 'WARN': 'WARNING',
    'ERROR': 'ERROR', 'FATAL': 'CRITICAL', 'MARK': 'CRITICAL', 'OFF': 'CRITICAL'};

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
                    throw new WError(err, 'Unable to read ' + descPath);
                }
                var content = fs.readFileSync(descPath).toString();
                var desc = JSON.parse(content);
                desc.path = processorPath;
                verifyProcessor(processorPath, desc, function(err) {
                    if (err) {
                        logger.error(getFullError(new WError(err, 'Verification of processor ' + desc.name + ' failed with error')));
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
        logger.error(getFullError(new WError(err, 'Error while discovering processor at ' + processorPath)));
        callback();
    }
}

/**
 * Initializes processors service. Discovers result processors on supplied processorsPath. Processor descriptors will be
 * supplied to promise upon completion.
 *
 * @returns promise
 */
function init(processorsPath) {
    // discover processors
    var itemPaths = fs.readdirSync(processorsPath);
    var processorDescs = [];
    var ok = nodefn.lift(async.each)(itemPaths, function(itemPath, callback) {
        discoverProcessor(processorDescs, path.join(processorsPath, itemPath), callback);
    });
    return ok.then(function onFullfilled() {
        initProcessorsMap(processorDescs);
        return processorDescs;
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
    return consumesItem.dataType;
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
            var parts = childLogRegExp.exec(logRecord);
            if (parts) {
                var logLevel = childLogLevelMap[parts[1]];
                if (logLevel) {
                    var logName = parts[2];
                    var message = parts[3];
                    processorDesc.logger.log(logLevel, logName + ' - ' + message);
                    return;
                }
            }
            processorDesc.logger.error(logRecord);
        }
    });
}

/**
 * Converts content metadata properties to environment variables object that can be used for process execution. We use
 * environment variables instead of process arguments since for program it may not be easy to read the arguments - one
 * has to use specialized argument parsing libraries which may be buggy or work differently. Its much easier to access
 * process environment variables. Environment variables will be prefixed with P_. String case is preserved.
 *
 * @param processorDesc
 * @param contentMetadata
 */
function getEnvParams(processorDesc, contentMetadata) {
    var envParams = util._extend({}, process.env);
    var keys = Object.keys(contentMetadata);
    for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        // we convert key to uppercase since in Windows env variable keys are not case sensitive, while in Linux they are
        envParams['P_' + key.toUpperCase()] = contentMetadata[key];
    }
    // translate log level
    var log4jsLevel = processorDesc.logger.level.levelStr;
    envParams.P_LOG_LEVEL = log4jsToChildLogLevelMap[log4jsLevel];
    return envParams;
}

/**
 * Reimplementation of node.js child_process#exec which doesn't have buffer size limitation and is suitable for processing
 * large data sizes. It uses spawn function instead.
 *
 * @param command command to execute
 * @param options options for process spawn
 */
function exec(command, options) {
    var file, args;
    if (process.platform === 'win32') {
        file = process.env.comspec || 'cmd.exe';
        args = ['/s', '/c', '"' + command + '"'];
        options = util._extend({}, options);
        options.windowsVerbatimArguments = true;
    } else {
        file = '/bin/sh';
        args = ['-c', command];
    }
    return childProcess.spawn(file, args, options);
}

/**
 * Executes result processor identified by processorDesc on file identified by fileMetadata. Processor will receive the
 * file on stdin and is expected to provide result in the form of JSON on stdout. The expected result is JSON array of
 * JSON objects.
 *
 * @param processorDesc result processor descriptor
 * @param processingMetadata - path, accessToken, tenantId
 * @param contentMetadata descriptor of content - contentType, dataType etc.
 * @returns {ProcessingNotifier} which allows caller to receive processed data, be informed about end or error
 */
function executeProcessor(processorDesc, processingMetadata, contentMetadata) {
    logger.debug('Executing processor ' + processorDesc.name);
    var readStream = fs.createReadStream(processingMetadata.path);
    var envParams = getEnvParams(processorDesc, contentMetadata);
    var child = exec(processorDesc.command, {cwd: processorDesc.path, env: envParams});
    child.once('error', function(err) {
        logger.debug('Execution of processor failed ', err);
    });
    child.once('exit', function() {
        logger.debug('Processor exited');
    });
    child.once('close', function() {
        readStream.destroy();
        cleanup();
    });
    var notifier = new ProcessingNotifier(processorDesc, child);

    // log child stderr into our logger
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
    function onObjectStreamEnd() {
        notifier._onDataEnd();
    }
    objectStream.output.on('end', onObjectStreamEnd);
    function onParserError(err) {
        // can be parsing error or error during execution of notifier 'data' handler
        var newErr = new WError(err, 'Error when handling response from \'' + processorDesc.name + '\'');
        notifier._emitError(newErr);
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
        objectStream.output.removeListener('end', onObjectStreamEnd);
        objectStream.streams[0].removeListener('error', onParserError);
    }

    return notifier;
}

/**
 * Processes a file using one of registered result processors.
 *
 * @param processingMetadata - contains path, tenantId, accessToken
 * @param contentMetadata describes content - contentType, dataType etc.
 * @returns {ProcessingNotifier} which allows caller to receive processed data, be informed about end or error
 */
function processFile(processingMetadata, contentMetadata) {
    // check if we actually support it
    var key = getProcessorsMapKey(contentMetadata);
    var processorDesc = processorsMap[key];
    if (processorDesc) {
        return executeProcessor(processorDesc, processingMetadata, contentMetadata);
    } else {
        throw new Error('Unsupported content ' + key);
    }
}

/**
 * Class responsible for notification of caller with JSON data returned by result processor. This class extends
 * EventEmitter.
 * 'data' event will be emitted whenever JSON object is sent by result processor. Receiver may choose to receive
 * several
 * objects before sending them in bulk for efficiency reasons. Listener function will receive an object parameter.
 * 'end' event will be emitted when no more data is to be expected. If process startup failed, process exited with non
 * 0
 * code or exited with 0 but there was a previous error there will be an error argument. In such case the operation is
 * not to be considered success.
 * 'error' event will be emitted if there was parsing error of result processor result. No more data events will be
 * emitted.
 *
 * @param processorDesc result processor descriptor
 * @param child result processor process
 * @constructor
 */
function ProcessingNotifier(processorDesc, child) {
    this._processorDesc = processorDesc;
    this._child = child;
    this._stopRequested = false;
    this._exited = false;
    this._hasError = false;
    this._dataEnded = false;
    var that = this;

    events.EventEmitter.call(this);

    function onProcessExit(code) {
        that._exited = true;
        var err;
        cleanup();
        if (that._stopRequested) {
            that._hasError = true;
            err = new Error('Result processor \'' + that._processorDesc.name + '\' was requested to stop and exited with ' + code);
            err.code = code;
            that.emit('end', err);
        } else if (that._hasError) {
            that._hasError = true;
            err = new Error('Result processing of \'' + that._processorDesc.name + '\' had a previous error, process exited with ' + code);
            err.code = code;
            that.emit('end', err);
        } else if (code !== 0) {
            that._hasError = true;
            err = new Error('Result processor \'' + that._processorDesc.name + '\' exited with ' + code);
            err.code = code;
            that.emit('end', err);
        } else if (that._dataEnded) {
            // data ended but we haven't emited 'end' yet since we waited for result code
            that.emit('end');
        } // else 0 code and there is still data to be parsed from stdout
    }
    function onProcessError(err) {
        that._exited = true;
        that._hasError = true;
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

/**
 * Emits data event with some object. This event will only be emited if there was no previous error and stop wasn't
 * requested. Otherwise it makes no sense to emit this event.
 *
 * @param data object the event should contain
 * @private
 */
ProcessingNotifier.prototype._emitData = function(data) {
    if (!this._hasError && !this._dataEnded && !this._stopRequested) {
        this.emit('data', data);
    }
};

/**
 * Emits error event.
 *
 * @param err instance of error
 * @private
 */
ProcessingNotifier.prototype._emitError = function(err) {
    this._hasError = true;
    this.emit('error', err);
};

/**
 * To be invoked when the whole output stream has been parsed and there are no more data to be emitted. Data end can
 * happen before or after child process exists.
 * @private
 */
ProcessingNotifier.prototype._onDataEnd = function() {
    this._dataEnded = true;
    if (this._exited && !this._hasError && !this._stopRequested) {
        // process already exited with 0 but no 'end' event was emitted yet
        this.emit('end');
    } // else 'end' will be emitted when process exits (wait for result code)
};

/**
 * Stops result processor by sending SIGTERM. To be invoked when its not meaningful to continue result processing
 * due to previous error when storing the processed data. No more data events will be emitted even if process refuses
 * to exit.
 */
ProcessingNotifier.prototype.stop = function() {
    this._stopRequested = true;
    if (!this._exited) {
        // sends SIGTERM to child process. Note that process may ignore it.
        this._child.kill();
    }
};

exports.init = init;
exports.processFile = processFile;
