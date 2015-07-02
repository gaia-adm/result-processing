/**
 * Metrics gateway client. Responsible for pushing processed metrics to metrics-gateway-service.
 *
 * @module service/metrics_gateway
 */
'use strict';

var log4js = require('log4js');
var request = require('request');
var VError = require('verror');

var logger = log4js.getLogger('metrics_gateway.js');

function send(accessToken, data, callback) {
    if (logger.level.level <= log4js.levels.DEBUG.level) {
        logger.debug('Sending to /mgs/rest/v1/gateway/publish: ' + JSON.stringify(data));
    }

    var body = JSON.stringify(Array.isArray(data) ? data : [data]);
    var options = {
        uri: 'http://metricsgw:9002/mgs/rest/v1/gateway/publish', method: 'POST', headers: {
            'content-type': 'application/json'
        }, auth: {
            sendImmediately: true, bearer: accessToken
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
