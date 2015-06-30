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
var makeSource  = require("stream-json");
var StreamArray = require("stream-json/utils/StreamArray");

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
    childProcess.exec(desc.command, {cwd: desc.path}, function (err, stdout, stderr) {
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

function onLogFromChild(processorDesc, str) {
    var logRecords = str.split(/\r?\n/);
    logRecords.forEach(function(logRecord) {
        if (logRecord.length > 0) {
            processorDesc.logger.info(logRecord);
        }
    });
}

function executeProcessor(processorDesc, fileDescriptor, readStream) {
    logger.debug('Executing processor ' + processorDesc.name);
    // TODO: setup env/args from fileDescriptor
    var child = childProcess.exec(processorDesc.command, {cwd: processorDesc.path}, function (err) {
        readStream.destroy();
        if (err) {
            logger.error('Execution of processor failed ', err);
        } else {
            console.log('Processor exited');
        }
    });

    // log child stderr as info
    var childErrStream = child.stderr;
    childErrStream.setEncoding('utf8');
    childErrStream.on('data', function(str) {
        onLogFromChild(processorDesc, str);
    });
    // parse JSON output on stdout
    var objectStream = StreamArray.make();
    objectStream.output.on('data', function(object) {
        // TODO: support bulk operations
        console.log(object.index, object.value);
    });
    objectStream.output.on('end', function() {
        console.log('done');
    });
    child.stdout.setEncoding('utf8');
    child.stdout.pipe(objectStream.input);
    // child process input is the stream
    readStream.pipe(child.stdin);
}

/**
 * Processes a file using one of registered result processors.
 *
 * @param fileDescriptor describes file - contains path, contentType, metric, category, name, tags etc.
 */
function processFile(fileDescriptor) {
    // check if we actually support it
    var key = getProcessorsMapKey(fileDescriptor);
    var processorDesc = processorsMap[key];
    if (processorDesc) {
        var readStream = fs.createReadStream(fileDescriptor.path);
        executeProcessor(processorDesc, fileDescriptor, readStream);
    } else {
        throw new Error('Unsupported content ' + key);
    }
}

exports.init = init;
exports.processFile = processFile;
