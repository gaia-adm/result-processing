/**
 * Module for methods related to error processing/logging
 * @module util/error-utils
 */
'use strict';

/**
 * Returns message containing details about given error and all its causes.
 * Without this function only root error details are logged.
 */
function getFullError(err) {
    var msg = err.stack;
    var curr = err;
    while (curr.cause && curr.cause()) {
        curr = curr.cause();
        msg = msg + '\nCaused by:\n' + curr.stack;
    }
    return msg;
}

exports.getFullError = getFullError;
