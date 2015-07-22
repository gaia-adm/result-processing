'use strict';
var chai = require('chai');
var assert = chai.assert;
var http = require('http');
var express = require('express');
var bodyParser = require('body-parser');
var HttpStatus = require('http-status-codes');

var metricsGateway = require('./../../service/metrics-gateway');

describe('metrics-gateway client tests', function() {

    describe('invalid metrics-gateway-service', function() {
        afterEach(function() {
            process.env.MSGW_HOST = null;
            process.env.MSGW_PORT = null;
        });

        it('send with invalid hostname', function(done) {
            process.env.MSGW_HOST = 'localhost';
            process.env.MSGW_PORT = 32000;
            metricsGateway.send({accessToken: 'accessToken'}, {some:'data'}, function(err) {
                assert(err instanceof Error, 'Expected the callback be called with an error');
                done();
            });
        });
    });

    describe('mock metrics-gateway-service', function() {
        var app;
        var handler;
        var server;

        before(function(done) {
            process.env.MSGW_HOST = 'localhost';
            // start internal express server on random port
            app = express();
            var router = express.Router();
            router.post('/mgs/rest/v1/gateway/publish', function(req, res) {
                if (handler) {
                    handler(req, res);
                } else {
                    throw new Error('REST handler is not set');
                }
            });
            app.use(bodyParser.json());
            app.use(router);
            app.use(defaultErrorHandler);
            server = http.createServer(app);
            server.listen(0, function () {
                process.env.MSGW_PORT = server.address().port;
                done();
            });
        });

        it('send without access token', function(done) {
            handler = function(req, res) {
                res.status(HttpStatus.UNAUTHORIZED); // simulate 401
                res.send();
            };
            metricsGateway.send({accessToken: null}, {some: 'data'}, function(err) {
                assert.instanceOf(err, Error, 'Expected the callback be called with an error');
                assert(err.message.indexOf('401') !== -1, 'Expected 401 response');
                done();
            });
        });

        it('send object accepted', function(done) {
            handler = function(req, res) {
                assert.strictEqual(req.get('Content-Type'), 'application/json', 'Expected application/json Content-Type');
                assert.deepEqual(req.body, [{some: 'data'}]);
                res.status(HttpStatus.CREATED);
                res.send();
            };
            metricsGateway.send({accessToken: 'access token'}, {some: 'data'}, function(err) {
                assert.isUndefined(err, 'Expected the callback be called without error');
                done();
            });
        });

        it('send array accepted', function(done) {
            handler = function(req, res) {
                assert.strictEqual(req.get('Content-Type'), 'application/json', 'Expected application/json Content-Type');
                assert.deepEqual(req.body, [{some1: 'data1'},{some2: 'data2'}]);
                res.status(HttpStatus.CREATED);
                res.send();
            };
            metricsGateway.send({accessToken: 'access token'}, [{some1: 'data1'},{some2: 'data2'}], function(err) {
                assert.isUndefined(err, 'Expected the callback be called without error');
                done();
            });
        });

        it('send with 500 response', function(done) {
            handler = function() {
                throw new Error('Test error');
            };
            metricsGateway.send({accessToken: 'access token'}, {some: 'data'}, function(err) {
                assert.instanceOf(err, Error, 'Expected the callback be called with an error');
                assert(err.message.indexOf('500') !== -1, 'Expected 500 response');
                done();
            });
        });

        after(function(done) {
            process.env.MSGW_HOST = null;
            process.env.MSGW_PORT = null;
            server.close(done);
        });

        function defaultErrorHandler(err, req, res, next) {
            if (!(err instanceof Error)) {return next(err);}

            console.error('Unhandled exception in REST call \'' + req.path + '\'');
            console.error(err.stack);
            res.status(HttpStatus.INTERNAL_SERVER_ERROR);
            res.contentType = 'application/json';
            res.send({error: err.message, stacktrace: err.stack});
        }
    });
});
