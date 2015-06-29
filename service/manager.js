/**
 * Responsible for result processing service startup. It coordinates work between different modules.
 *
 * @module service/manager
 */
'use strict';

var log4js = require('log4js');
var processors = require('./processors');

var logger = log4js.getLogger('manager.js');

/**
 * Returns comma separated names of processors
 * @param processors array of processor descriptors
 * @returns {string}
 */
function getProcessorNames(processors) {
    var names = [];
    processors.forEach(function(processor) {
        names.push(processor.name);
    });
    return names.toString();
}

function startServer(processorsPath, callback) {
    // discover result processors
    return processors.init(processorsPath, function(err, processorDescs) {
        if (err) {
            callback(err);
        } else {
            // we got array of discovered processors
            if (processorDescs.length > 0) {
                logger.info('Found the following result processors: ' + getProcessorNames(processorDescs));
                // TODO: connect to AMQ based on processor descriptor listener config
            } else {
                logger.error('Found no result processors');
            }
        }
    });
}

exports.startServer = startServer;
