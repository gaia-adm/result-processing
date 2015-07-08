'use strict';
var chai = require('chai');
var assert = chai.assert;
var when = require('when');
var sinon = require('sinon');
var mockery = require('mockery');

describe('manager tests', function() {
    var manager;
    // real modules
    var processors;
    var notification;
    var metricsGateway;
    // stub objects
    var processorsStub;
    var notificationStub;
    var metricsGatewayStub;

    beforeEach(function() {
        mockery.enable({warnOnUnregistered: false, useCleanCache: true});
        // these will have all their methods stubbed. We want always new instances, therefore useCleanCache: true
        processors = require('./../../service/processors');
        notification = require('./../../service/notification');
        metricsGateway = require('./../../service/metrics-gateway');
        // create stubs. Sinon replaces all original methods with stub methods on original objects.
        // we create stubs for all our dependencies, because mocks don't replace all methods, just one
        processorsStub = sinon.stub(processors);
        notificationStub = sinon.stub(notification);
        metricsGatewayStub = sinon.stub(metricsGateway);
        // if usage of sinon mocks is required in test, restore given method (get rid of stub) and mock it instead

        manager = require('./../../service/manager');
    });

    describe('startup & shutdown', function() {
        it('startup with path without processors', function(done) {
            var processorDescs = [];
            // setup stubs
            // setup mocks
            var mock = sinon.mock(processors);
            processorsStub.init.restore();
            mock.expects('init').once().withExactArgs('no-processors-path').returns(when.resolve(processorDescs));

            manager.startServer('no-processors-path').done(function onOk() {
                assert.fail(null, null, 'Expected an error');
            }, function onError(err) {
                mock.verify();
                assert(err.message.indexOf('Found no result processors') !== -1, 'Expected "Found no result processors" error');
                done();
            });
        });

        it('startup with path with processors', function(done) {
            var processorDescs = [{
              "name": "test-processor",
              "command": "node processor.js",
              "consumes" : [{"metric": "test-processor-metric", "category": "test-processor-category"}]
            }];
            // setup stubs
            processorsStub.init.returns(when.resolve(processorDescs));
            // setup mocks
            var mock = sinon.mock(notification);
            notificationStub.initAmq.restore();
            mock.expects('initAmq').once().withExactArgs(sinon.match(processorDescs), sinon.match.func).returns(when.resolve());

            manager.startServer('processors-path').done(function onOk() {
                mock.verify();
                done();
            }, function onError(err) {
                assert.fail(err, null, 'Expected no error');
            });
        });

        it('shutdown', function(done) {
            var processorDescs = [{
              "name": "test-processor",
              "command": "node processor.js",
              "consumes" : [{"metric": "test-processor-metric", "category": "test-processor-category"}]
            }];
            // setup stubs
            processorsStub.init.returns(when.resolve(processorDescs));
            notificationStub.initAmq.returns(when.resolve());
            // setup mocks
            var mock = sinon.mock(notification);
            notificationStub.shutdown.restore();
            mock.expects('shutdown').once().returns(when.resolve());

            var ok = manager.startServer('processors-path');
            ok = ok.then(function onOk() {
                return manager.shutdown();
            });
            ok.done(function onOk() {
                mock.verify();
                done();
            }, function onError(err) {
                assert.fail(err, null, 'Expected no error');
            });
        });
    });

    afterEach(function() {
        mockery.deregisterAll();
        mockery.disable();
    });
});
