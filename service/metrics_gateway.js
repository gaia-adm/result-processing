/**
 * Metrics gateway client. Responsible for pushing processed metrics to metrics-gateway-service.
 *
 * @module service/metrics_gateway
 */
'use strict';

var log4js = require('log4js');
var request = require('request');

var logger = log4js.getLogger('metrics_gateway.js');

function send(authorization, data, callback) {
    // POST /mgs/rest/v1/gateway/publish
    // Content-Type: application/json, Accept: application/json, Authorization: Bearer
    // Response code: 201
    logger.debug('Sending data to /mgs/rest/v1/gateway/publish');
    // TODO: implement
    callback();
}

exports.send = send;
