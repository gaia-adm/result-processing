/**
 * GAIA result processing service. It receives notifications about files waiting to be processed, reads file, passes content
 * to result processor on STDIN and reads measures JSON response on STDOUT. Processor must do logging on STDERR. File
 * content can be textual or binary. Location of processors can be customized by using PROCESSORS_PATH environment variable.
 * By default they are assumed to be present in subdirectory 'processors'. All processors must contain processor-descriptor.json
 * that describes name of the processor, the command to execute for processing and what kind of data it is interested in.
 */
'use strict';

var log4js = require('log4js');
// replaces console.log function with log4j
log4js.replaceConsole();
if (process.env.LOG_LEVEL) {
    log4js.setGlobalLogLevel(process.env.LOG_LEVEL);
}
var logger = log4js.getLogger('server.js');

var grace = require('grace');
var manager = require('./service/manager');
var path = require('path');

var graceApp = grace.create();

exitOnSignal('SIGINT');
exitOnSignal('SIGTERM');

function exitOnSignal(signal) {
    process.on(signal, function() {
        logger.debug('Caught ' + signal + ', exiting');
        graceApp.shutdown(0);
    });
}

var processorsPath = process.env.PROCESSORS_PATH || path.join(__dirname, 'processors');

graceApp.on('start', function () {
    manager.startServer(processorsPath).done(function onOk() {
        logger.info(' [*] Waiting for messages. To exit press CTRL+C');
    }, function onError(err) {
        logger.error('Server failed to start due to error', err);
        graceApp.shutdown(1);
    });
});

graceApp.on('error', function(err){
    console.error(err);
});

graceApp.on('shutdown', function(cb) {
    manager.shutdown().done(function onOk() {
        cb();
    }, function onFailed(err) {
        cb(err);
    });
});

graceApp.on ('exit', function(code){
    logger.debug('Exiting with code ' + code);
});

graceApp.start();
