/**
 * Metrics gateway client. Responsible for pushing processed metrics to metrics-gateway-service.
 *
 * @module service/metrics-gateway
 */
'use strict';

var log4js = require('log4js');
var request = require('request');
var VError = require('verror');

var logger = log4js.getLogger('metrics_gateway.js');

/**
 * Returns URI where measures/metrics should be sent.
 *
 * @returns {string}
 */
function getSendUri() {
    if (!process.env.MGS_SERVER) {
        throw new Error('MGS_SERVER environment variable is not specified');
    }
    return 'http://' + process.env.MGS_SERVER + '/mgs/rest/v1/gateway/event';
}

/**
 * Sends measures/metrics to metrics-gateway-service.
 *
 * @param processingMetadata object containing accessToken, path, tenantId
 * @param data an object to send or array of objects
 * @param callback callback that will be notified upon success/error
 */
function send(processingMetadata, data, callback) {
    if (logger.isLevelEnabled(log4js.levels.TRACE)) {
        logger.debug('Sending to /mgs/rest/v1/gateway/event: ' + JSON.stringify(data));
    } else if (logger.isLevelEnabled(log4js.levels.DEBUG)) {
        logger.debug('Sending to /mgs/rest/v1/gateway/event: ' + JSON.stringify(data).substr(0, 50) + '...');
    }

    var body = JSON.stringify(Array.isArray(data) ? data : [data]);
    var options = {
        uri: getSendUri(), method: 'POST', headers: {
            'content-type': 'application/json'
        }, auth: {
            sendImmediately: true, bearer: processingMetadata.accessToken
        }, body: body
    };
    request(options, function(err, response, body) {
        if (err) {
            logger.error(err.stack);
            callback(new VError(err, 'Failed to push metrics to metrics gateway'));
        } else {
            if (response.statusCode >= 200 && response.statusCode < 300) {
                callback();
            } else {
                logger.error('Failed to push metrics to metrics gateway, status code '+ response.statusCode);
                logger.error(body);
                callback(new Error('Failed to push metrics to metrics gateway, status code '+ response.statusCode));
            }
        }
    });
}

exports.send = send;
