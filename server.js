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
var logger = log4js.getLogger('server.js');

var manager = require('./service/manager');
var path = require('path');

exitOnSignal('SIGINT');
exitOnSignal('SIGTERM');

// TODO: use grace or other module for graceful shutdown (close sockets etc) - not easy as we need to exec async code in multiple modules
function exitOnSignal(signal) {
    process.on(signal, function() {
        logger.debug('Caught ' + signal + ', exiting');
        process.exit(1);
    });
}

var processorsPath = process.env.PROCESSORS_PATH || path.join(__dirname, 'processors');

manager.startServer(processorsPath, function(err) {
    if (err) {
        logger.error('Server failed to start due to error', err);
    }
});
