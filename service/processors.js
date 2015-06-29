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

var logger = log4js.getLogger('processors.js');

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
            initCallback(null, processorDescs);
        }
    });
}

exports.init = init;
