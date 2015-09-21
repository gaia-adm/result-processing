'use strict';
var chai = require('chai');
var assert = chai.assert;
var tmp = require('tmp');
var events = require("events");
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
    // mocks
    var fsMock;

    var processorDescs;

    beforeEach(function() {
        process.env.METRICS_BATCH_SIZE = null;
        processorDescs = [{
          "name": "test-processor",
          "command": "node processor.js",
          "consumes" : [{"dataType": "test-processor-metric/test-processor-category"}]
        }];

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
        var fs = require('fs');
        fsMock = sinon.mock(fs);

        manager = require('./../../service/manager');
    });

    describe('startup & shutdown', function() {
        it('startup with path without processors', function(done) {
            processorDescs = [];
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
            // setup stubs
            processorsStub.init.returns(when.resolve(processorDescs));
            // setup mocks
            var mock = sinon.mock(notification);
            notificationStub.initAmq.restore();
            mock.expects('initAmq').once().withExactArgs(sinon.match(processorDescs), sinon.match.func, sinon.match(true)).returns(when.resolve());

            manager.startServer('processors-path').done(function onOk() {
                mock.verify();
                done();
            }, function onError(err) {
                assert.fail(err, null, 'Expected no error');
            });
        });

        it('shutdown', function(done) {
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

    describe('message processing', function() {
        it('no data, end', function(done) {
            var msgConsumer;
            var tmpFile = tmp.fileSync();
            var processingMetadata = {accessToken: 'authToken', path: tmpFile.name};
            var contentMetadata = {'dataType': 'test-processor-metric/test-processor-category'};
            var processFileCalled = 0;
            // setup stubs
            processorsStub.init.returns(when.resolve(processorDescs));
            notificationStub.initAmq.returns(when.resolve());
            // setup mocks
            fsMock.expects('unlink').once().yields();
            processorsStub.processFile.restore();
            processors.processFile = function(paramProcessingMetadata, paramContentMetadata) {
                processFileCalled++;
                assert.deepEqual(paramProcessingMetadata, processingMetadata);
                assert.deepEqual(paramContentMetadata, contentMetadata);
                var eventEmitter = new events.EventEmitter();
                // generate events for test
                setTimeout(function() {
                    eventEmitter.emit('end');
                }, 1);
                return eventEmitter;
            };
            function onAck() {
                setTimeout(function() {
                    assert.strictEqual(processFileCalled, 1, 'Expected processFile to be called');
                    fsMock.verify();
                    done();
                }, 1);
            }
            function onNack() {
                assert.fail(null, null, 'Nack was not expected');
            }
            var ackControl = {ack: onAck, nack: onNack};

            var ok = manager.startServer('processors-path');
            ok.done(function onOk() {
                msgConsumer = notificationStub.initAmq.firstCall.args[1];
                // send message to msgConsumer
                setTimeout(function() {
                    var msg = createMockMessage(processingMetadata, contentMetadata);
                    msgConsumer(msg, ackControl);
                }, 1);
            }, function onError(err) {
                assert.fail(err, null, 'Expected no error');
            });
        });

        it('no data, end with error', function(done) {
            var msgConsumer;
            var tmpFile = tmp.fileSync();
            var processingMetadata = {accessToken: 'authToken', path: tmpFile.name};
            var contentMetadata = {'dataType': 'test-processor-metric/test-processor-category'};
            var processFileCalled = 0;
            // setup stubs
            processorsStub.init.returns(when.resolve(processorDescs));
            notificationStub.initAmq.returns(when.resolve());
            // setup mocks
            fsMock.expects('unlink').never();
            processorsStub.processFile.restore();
            processors.processFile = function(paramProcessingMetadata, paramContentMetadata) {
                processFileCalled++;
                assert.deepEqual(paramProcessingMetadata, processingMetadata);
                assert.deepEqual(paramContentMetadata, contentMetadata);
                var eventEmitter = new events.EventEmitter();
                // generate events for test
                setTimeout(function() {
                    eventEmitter.emit('end', new Error('Test error'));
                }, 1);
                return eventEmitter;
            };
            function onAck() {
                setTimeout(function() {
                    assert.strictEqual(processFileCalled, 1, 'Expected processFile to be called');
                    fsMock.verify();
                    done();
                }, 1);
            }
            function onNack() {
                assert.fail(null, null, 'Nack was not expected');
            }
            var ackControl = {ack: onAck, nack: onNack};

            var ok = manager.startServer('processors-path');
            ok.done(function onOk() {
                msgConsumer = notificationStub.initAmq.firstCall.args[1];
                // send message to msgConsumer
                setTimeout(function() {
                    var msg = createMockMessage(processingMetadata, contentMetadata);
                    msgConsumer(msg, ackControl);
                }, 1);
            }, function onError(err) {
                assert.fail(err, null, 'Expected no error');
            });
        });

        it('1x data with batch size 1, end', function(done) {
            var msgConsumer;
            var tmpFile = tmp.fileSync();
            var processingMetadata = {accessToken: 'authToken', path: tmpFile.name};
            var contentMetadata = {'dataType': 'test-processor-metric/test-processor-category'};
            var data = {some: 'data'};
            var processFileCalled = 0;
            process.env.METRICS_BATCH_SIZE = 1;
            // setup stubs
            processorsStub.init.returns(when.resolve(processorDescs));
            notificationStub.initAmq.returns(when.resolve());
            // setup mocks
            fsMock.expects('unlink').once().yields();
            processorsStub.processFile.restore();
            processors.processFile = function(paramProcessingMetadata, paramContentMetadata) {
                processFileCalled++;
                assert.deepEqual(paramProcessingMetadata, processingMetadata);
                assert.deepEqual(paramContentMetadata, contentMetadata);
                var eventEmitter = new events.EventEmitter();
                // generate events for test
                setTimeout(function() {
                    eventEmitter.emit('data', data);
                    eventEmitter.emit('end');
                }, 1);
                return eventEmitter;
            };
            metricsGatewayStub.send.restore();
            var metricsGatewayMock = sinon.mock(metricsGateway);
            metricsGatewayMock.expects('send').once().withArgs(processingMetadata, sinon.match([data])).yields();
            function onAck() {
                setTimeout(function() {
                    assert.strictEqual(processFileCalled, 1, 'Expected processFile to be called');
                    metricsGatewayMock.verify();
                    fsMock.verify();
                    done();
                }, 1);
            }
            function onNack() {
                assert.fail(null, null, 'Nack was not expected');
            }
            var ackControl = {ack: onAck, nack: onNack};

            var ok = manager.startServer('processors-path');
            ok.done(function onOk() {
                msgConsumer = notificationStub.initAmq.firstCall.args[1];
                // send message to msgConsumer
                setTimeout(function() {
                    var msg = createMockMessage(processingMetadata, contentMetadata);
                    msgConsumer(msg, ackControl);
                }, 1);
            }, function onError(err) {
                assert.fail(err, null, 'Expected no error');
            });
        });

        it('1x data with batch size 1, send error, end with error', function(done) {
            var msgConsumer;
            var tmpFile = tmp.fileSync();
            var processingMetadata = {accessToken: 'authToken', path: tmpFile.name};
            var contentMetadata = {'dataType': 'test-processor-metric/test-processor-category'};
            var data = {some: 'data'};
            var processFileCalled = 0;
            process.env.METRICS_BATCH_SIZE = 1;
            // setup stubs
            processorsStub.init.returns(when.resolve(processorDescs));
            notificationStub.initAmq.returns(when.resolve());
            // setup mocks
            fsMock.expects('unlink').never();
            var eventEmitter = new events.EventEmitter();
            eventEmitter.stop = sinon.mock();
            eventEmitter.stop.once();
            processorsStub.processFile.restore();
            processors.processFile = function(paramProcessingMetadata, paramContentMetadata) {
                processFileCalled++;
                assert.deepEqual(paramProcessingMetadata, processingMetadata);
                assert.deepEqual(paramContentMetadata, contentMetadata);
                // generate events for test
                setTimeout(function() {
                    eventEmitter.emit('data', data);
                    eventEmitter.emit('end', new Error('Test error'));
                }, 1);
                return eventEmitter;
            };
            metricsGatewayStub.send.restore();
            var metricsGatewayMock = sinon.mock(metricsGateway);
            metricsGatewayMock.expects('send').once().withArgs(processingMetadata, sinon.match([data])).yields(new Error('Test error'));
            function onAck() {
                setTimeout(function() {
                    assert.strictEqual(processFileCalled, 1, 'Expected processFile to be called');
                    metricsGatewayMock.verify();
                    eventEmitter.stop.verify();
                    fsMock.verify();
                    done();
                }, 1);
            }
            function onNack() {
                assert.fail(null, null, 'Nack was not expected');
            }
            var ackControl = {ack: onAck, nack: onNack};

            var ok = manager.startServer('processors-path');
            ok.done(function onOk() {
                msgConsumer = notificationStub.initAmq.firstCall.args[1];
                // send message to msgConsumer
                setTimeout(function() {
                    var msg = createMockMessage(processingMetadata, contentMetadata);
                    msgConsumer(msg, ackControl);
                }, 1);
            }, function onError(err) {
                assert.fail(err, null, 'Expected no error');
            });
        });

        it('1x data with batch size 1, end with error', function(done) {
            var msgConsumer;
            var tmpFile = tmp.fileSync();
            var processingMetadata = {accessToken: 'authToken', path: tmpFile.name};
            var contentMetadata = {'dataType': 'test-processor-metric/test-processor-category'};
            var data = {some: 'data'};
            var processFileCalled = 0;
            process.env.METRICS_BATCH_SIZE = 1;
            // setup stubs
            processorsStub.init.returns(when.resolve(processorDescs));
            notificationStub.initAmq.returns(when.resolve());
            // setup mocks
            fsMock.expects('unlink').never();
            processorsStub.processFile.restore();
            processors.processFile = function(paramProcessingMetadata, paramContentMetadata) {
                processFileCalled++;
                assert.deepEqual(paramProcessingMetadata, processingMetadata);
                assert.deepEqual(paramContentMetadata, contentMetadata);
                var eventEmitter = new events.EventEmitter();
                // generate events for test
                setTimeout(function() {
                    eventEmitter.emit('data', data);
                    eventEmitter.emit('end', new Error('Test error'));
                }, 1);
                return eventEmitter;
            };
            metricsGatewayStub.send.restore();
            var metricsGatewayMock = sinon.mock(metricsGateway);
            metricsGatewayMock.expects('send').once().withArgs(processingMetadata, sinon.match([data])).yields();
            function onAck() {
                setTimeout(function() {
                    assert.strictEqual(processFileCalled, 1, 'Expected processFile to be called');
                    metricsGatewayMock.verify();
                    fsMock.verify();
                    done();
                }, 1);
            }
            function onNack() {
                assert.fail(null, null, 'Nack was not expected');
            }
            var ackControl = {ack: onAck, nack: onNack};

            var ok = manager.startServer('processors-path');
            ok.done(function onOk() {
                msgConsumer = notificationStub.initAmq.firstCall.args[1];
                // send message to msgConsumer
                setTimeout(function() {
                    var msg = createMockMessage(processingMetadata, contentMetadata);
                    msgConsumer(msg, ackControl);
                }, 1);
            }, function onError(err) {
                assert.fail(err, null, 'Expected no error');
            });
        });

        it('1x data with batch size 1, parse error, end with error', function(done) {
            var msgConsumer;
            var tmpFile = tmp.fileSync();
            var processingMetadata = {accessToken: 'authToken', path: tmpFile.name};
            var contentMetadata = {'dataType': 'test-processor-metric/test-processor-category'};
            var data = {some: 'data'};
            var processFileCalled = 0;
            process.env.METRICS_BATCH_SIZE = 1;
            // setup stubs
            processorsStub.init.returns(when.resolve(processorDescs));
            notificationStub.initAmq.returns(when.resolve());
            // setup mocks
            fsMock.expects('unlink').never();
            processorsStub.processFile.restore();
            processors.processFile = function(paramProcessingMetadata, paramContentMetadata) {
                processFileCalled++;
                assert.deepEqual(paramProcessingMetadata, processingMetadata);
                assert.deepEqual(paramContentMetadata, contentMetadata);
                var eventEmitter = new events.EventEmitter();
                // generate events for test
                setTimeout(function() {
                    eventEmitter.emit('data', data);
                    eventEmitter.emit('error', new Error('Test error'));
                    eventEmitter.emit('end', new Error('Test error'));
                }, 1);
                return eventEmitter;
            };
            metricsGatewayStub.send.restore();
            var metricsGatewayMock = sinon.mock(metricsGateway);
            metricsGatewayMock.expects('send').once().withArgs(processingMetadata, sinon.match([data])).yields();
            function onAck() {
                setTimeout(function() {
                    assert.strictEqual(processFileCalled, 1, 'Expected processFile to be called');
                    metricsGatewayMock.verify();
                    fsMock.verify();
                    done();
                }, 1);
            }
            function onNack() {
                assert.fail(null, null, 'Nack was not expected');
            }
            var ackControl = {ack: onAck, nack: onNack};

            var ok = manager.startServer('processors-path');
            ok.done(function onOk() {
                msgConsumer = notificationStub.initAmq.firstCall.args[1];
                // send message to msgConsumer
                setTimeout(function() {
                    var msg = createMockMessage(processingMetadata, contentMetadata);
                    msgConsumer(msg, ackControl);
                }, 1);
            }, function onError(err) {
                assert.fail(err, null, 'Expected no error');
            });
        });

        it('1x data with batch size 10, end', function(done) {
            var msgConsumer;
            var tmpFile = tmp.fileSync();
            var processingMetadata = {accessToken: 'authToken', path: tmpFile.name};
            var contentMetadata = {'dataType': 'test-processor-metric/test-processor-category'};
            var data = {some: 'data'};
            var processFileCalled = 0;
            process.env.METRICS_BATCH_SIZE = 10;
            // setup stubs
            processorsStub.init.returns(when.resolve(processorDescs));
            notificationStub.initAmq.returns(when.resolve());
            // setup mocks
            fsMock.expects('unlink').once().yields();
            processorsStub.processFile.restore();
            processors.processFile = function(paramProcessingMetadata, paramContentMetadata) {
                processFileCalled++;
                assert.deepEqual(paramProcessingMetadata, processingMetadata);
                assert.deepEqual(paramContentMetadata, contentMetadata);
                var eventEmitter = new events.EventEmitter();
                // generate events for test
                setTimeout(function() {
                    eventEmitter.emit('data', data);
                    eventEmitter.emit('end');
                }, 1);
                return eventEmitter;
            };
            metricsGatewayStub.send.restore();
            var metricsGatewayMock = sinon.mock(metricsGateway);
            metricsGatewayMock.expects('send').once().withArgs(processingMetadata, sinon.match([data])).yields();
            function onAck() {
                setTimeout(function() {
                    assert.strictEqual(processFileCalled, 1, 'Expected processFile to be called');
                    metricsGatewayMock.verify();
                    fsMock.verify();
                    done();
                }, 1);
            }
            function onNack() {
                assert.fail(null, null, 'Nack was not expected');
            }
            var ackControl = {ack: onAck, nack: onNack};

            var ok = manager.startServer('processors-path');
            ok.done(function onOk() {
                msgConsumer = notificationStub.initAmq.firstCall.args[1];
                // send message to msgConsumer
                setTimeout(function() {
                    var msg = createMockMessage(processingMetadata, contentMetadata);
                    msgConsumer(msg, ackControl);
                }, 1);
            }, function onError(err) {
                assert.fail(err, null, 'Expected no error');
            });
        });

        it('2x data with batch size 2, end', function(done) {
            var msgConsumer;
            var tmpFile = tmp.fileSync();
            var processingMetadata = {accessToken: 'authToken', path: tmpFile.name};
            var contentMetadata = {'dataType': 'test-processor-metric/test-processor-category'};
            var data1 = {some1: 'data1'};
            var data2 = {some2: 'data2'};
            var processFileCalled = 0;
            process.env.METRICS_BATCH_SIZE = 2;
            // setup stubs
            processorsStub.init.returns(when.resolve(processorDescs));
            notificationStub.initAmq.returns(when.resolve());
            // setup mocks
            fsMock.expects('unlink').once().yields();
            processorsStub.processFile.restore();
            processors.processFile = function(paramProcessingMetadata, paramContentMetadata) {
                processFileCalled++;
                assert.deepEqual(paramProcessingMetadata, processingMetadata);
                assert.deepEqual(paramContentMetadata, contentMetadata);
                var eventEmitter = new events.EventEmitter();
                // generate events for test
                setTimeout(function() {
                    eventEmitter.emit('data', data1);
                    eventEmitter.emit('data', data2);
                    eventEmitter.emit('end');
                }, 1);
                return eventEmitter;
            };
            metricsGatewayStub.send.restore();
            var metricsGatewayMock = sinon.mock(metricsGateway);
            metricsGatewayMock.expects('send').once().withArgs(processingMetadata, sinon.match([data1, data2])).yields();
            function onAck() {
                setTimeout(function() {
                    assert.strictEqual(processFileCalled, 1, 'Expected processFile to be called');
                    metricsGatewayMock.verify();
                    fsMock.verify();
                    done();
                }, 1);
            }
            function onNack() {
                assert.fail(null, null, 'Nack was not expected');
            }
            var ackControl = {ack: onAck, nack: onNack};

            var ok = manager.startServer('processors-path');
            ok.done(function onOk() {
                msgConsumer = notificationStub.initAmq.firstCall.args[1];
                // send message to msgConsumer
                setTimeout(function() {
                    var msg = createMockMessage(processingMetadata, contentMetadata);
                    msgConsumer(msg, ackControl);
                }, 1);
            }, function onError(err) {
                assert.fail(err, null, 'Expected no error');
            });
        });

        it('3x data with batch size 2, end', function(done) {
            var msgConsumer;
            var tmpFile = tmp.fileSync();
            var processingMetadata = {accessToken: 'authToken', path: tmpFile.name};
            var contentMetadata = {'dataType': 'test-processor-metric/test-processor-category'};
            var data1 = {some1: 'data1'};
            var data2 = {some2: 'data2'};
            var data3 = {some3: 'data3'};
            var processFileCalled = 0;
            process.env.METRICS_BATCH_SIZE = 2;
            // setup stubs
            processorsStub.init.returns(when.resolve(processorDescs));
            notificationStub.initAmq.returns(when.resolve());
            // setup mocks
            fsMock.expects('unlink').once().yields();
            processorsStub.processFile.restore();
            processors.processFile = function(paramProcessingMetadata, paramContentMetadata) {
                processFileCalled++;
                assert.deepEqual(paramProcessingMetadata, processingMetadata);
                assert.deepEqual(paramContentMetadata, contentMetadata);
                var eventEmitter = new events.EventEmitter();
                // generate events for test
                setTimeout(function() {
                    eventEmitter.emit('data', data1);
                    eventEmitter.emit('data', data2);
                    eventEmitter.emit('data', data3);
                    eventEmitter.emit('end');
                }, 1);
                return eventEmitter;
            };
            metricsGatewayStub.send.restore();
            var metricsGatewayMock = sinon.mock(metricsGateway);
            var sendMock = metricsGatewayMock.expects('send').twice().yields();
            function onAck() {
                setTimeout(function() {
                    assert.strictEqual(processFileCalled, 1, 'Expected processFile to be called');
                    metricsGatewayMock.verify();
                    assert.strictEqual(sendMock.firstCall.args[0], processingMetadata);
                    assert.deepEqual(sendMock.firstCall.args[1], [data1, data2]);
                    assert.strictEqual(sendMock.secondCall.args[0], processingMetadata);
                    assert.deepEqual(sendMock.secondCall.args[1], [data3]);
                    fsMock.verify();
                    done();
                }, 1);
            }
            function onNack() {
                assert.fail(null, null, 'Nack was not expected');
            }
            var ackControl = {ack: onAck, nack: onNack};

            var ok = manager.startServer('processors-path');
            ok.done(function onOk() {
                msgConsumer = notificationStub.initAmq.firstCall.args[1];
                // send message to msgConsumer
                setTimeout(function() {
                    var msg = createMockMessage(processingMetadata, contentMetadata);
                    msgConsumer(msg, ackControl);
                }, 1);
            }, function onError(err) {
                assert.fail(err, null, 'Expected no error');
            });
        });

        it('4x data with batch size 2, end', function(done) {
            var msgConsumer;
            var tmpFile = tmp.fileSync();
            var processingMetadata = {accessToken: 'authToken', path: tmpFile.name};
            var contentMetadata = {'dataType': 'test-processor-metric/test-processor-category'};
            var data1 = {some1: 'data1'};
            var data2 = {some2: 'data2'};
            var data3 = {some3: 'data3'};
            var data4 = {some4: 'data4'};
            var processFileCalled = 0;
            process.env.METRICS_BATCH_SIZE = 2;
            // setup stubs
            processorsStub.init.returns(when.resolve(processorDescs));
            notificationStub.initAmq.returns(when.resolve());
            // setup mocks
            fsMock.expects('unlink').once().yields();
            processorsStub.processFile.restore();
            processors.processFile = function(paramProcessingMetadata, paramContentMetadata) {
                processFileCalled++;
                assert.deepEqual(paramProcessingMetadata, processingMetadata);
                assert.deepEqual(paramContentMetadata, contentMetadata);
                var eventEmitter = new events.EventEmitter();
                // generate events for test
                setTimeout(function() {
                    eventEmitter.emit('data', data1);
                    eventEmitter.emit('data', data2);
                    eventEmitter.emit('data', data3);
                    eventEmitter.emit('data', data4);
                    eventEmitter.emit('end');
                }, 1);
                return eventEmitter;
            };
            metricsGatewayStub.send.restore();
            var metricsGatewayMock = sinon.mock(metricsGateway);
            var sendMock = metricsGatewayMock.expects('send').twice().yields();
            function onAck() {
                setTimeout(function() {
                    assert.strictEqual(processFileCalled, 1, 'Expected processFile to be called');
                    metricsGatewayMock.verify();
                    assert.strictEqual(sendMock.firstCall.args[0], processingMetadata);
                    assert.deepEqual(sendMock.firstCall.args[1], [data1, data2]);
                    assert.strictEqual(sendMock.secondCall.args[0], processingMetadata);
                    assert.deepEqual(sendMock.secondCall.args[1], [data3, data4]);
                    fsMock.verify();
                    done();
                }, 1);
            }
            function onNack() {
                assert.fail(null, null, 'Nack was not expected');
            }
            var ackControl = {ack: onAck, nack: onNack};

            var ok = manager.startServer('processors-path');
            ok.done(function onOk() {
                msgConsumer = notificationStub.initAmq.firstCall.args[1];
                // send message to msgConsumer
                setTimeout(function() {
                    var msg = createMockMessage(processingMetadata, contentMetadata);
                    msgConsumer(msg, ackControl);
                }, 1);
            }, function onError(err) {
                assert.fail(err, null, 'Expected no error');
            });
        });

        function createMockMessage(processingMetadata, fileMetadata) {
            return {
                properties: {
                    headers: processingMetadata
                }, content: new Buffer(JSON.stringify(fileMetadata))
            };
        }
    });

    afterEach(function() {
        process.env.METRICS_BATCH_SIZE = null;
        mockery.deregisterAll();
        mockery.disable();
    });
});
