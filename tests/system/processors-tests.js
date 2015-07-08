'use strict';
var chai = require("chai");
var assert = chai.assert;
var when = require('when');
var uuid = require('node-uuid');
var path = require('path');
var tmp = require('tmp');
var fs = require('fs');
var log4js = require('log4js');
var processors = require('./../../service/processors');

describe('processors tests', function() {
    describe('init', function() {
        it('invalid processors path', function() {
            try {
                processors.init(path.join(__dirname, uuid.v4())).done(null, function onError(err) {
                    assert.fail(err, null, 'no error was expected here');
                });
            } catch (err) {
                assert(err.message.indexOf('no such file or directory') !== -1, 'Expected "no such file or directory" error');
            }
        });

        it('no processors in path', function(done) {
            processors.init(path.join(__dirname, 'no-processors')).done(function onOk(processorDescs) {
                assert.isArray(processorDescs, 'expected an array');
                assert.strictEqual(processorDescs.length, 0, 'expected empty array');
                done();
            }, function onError(err) {
                assert.fail(err, null, 'Failed to initialize processors module');
            });
        });

        it('with processors in path', function(done) {
            processors.init(path.join(__dirname, 'test-processors')).done(function onOk(processorDescs) {
                assert.isArray(processorDescs, 'expected an array');
                assert(processorDescs.length > 0, 'expected at least one processor in array');
                done();
            }, function onError(err) {
                assert.fail(err, null, 'Failed to initialize processors module');
            });
        });
    });

    describe('processFile', function() {
        var processorDescs;
        var customLogAppender;

        before(function(done) {
            processors.init(path.join(__dirname, 'test-processors')).done(function onOk(descriptors) {
                assert.isArray(descriptors, 'expected an array');
                assert(descriptors.length > 0, 'expected at least one processor in array');
                processorDescs = descriptors;
                done();
            }, function onError(err) {
                assert.fail(err, null, 'Failed to initialize processors module');
            });
            log4js.addAppender(function(loggingEvent) {
                if (customLogAppender) {
                    customLogAppender(loggingEvent);
                }
            });
        });

        beforeEach(function() {
            customLogAppender = null;
        });

        it('always-error', function() {
            var tmpFile = tmp.fileSync();
            // since the processor returned 1 during test execution in init(), it is not considered to be functional
            try {
                processors.processFile({'metric': 'always-error', 'category': 'always-error', path: tmpFile.name});
                assert.fail(null, null, 'Expected "Unsupported content" error');
            } catch (err) {
                assert(err.message.indexOf('Unsupported content') !== -1, 'Expected "Unsupported content" error');
            }
        });

        it('no-consumes', function() {
            var processorDesc = findProcessorDesc('no-consumes');
            assert.strictEqual(processorDesc, null, 'Expected "no-consumes" not to be found');
        });

        it('with-logging', function(done) {
            var tmpFile = tmp.fileSync();
            var fileDesc = {'metric': 'with-logging', 'category': 'with-logging', path: tmpFile.name};
            customLogAppender = function(loggingEvent) {
                var data = loggingEvent.data;
                for (var prop in data) {
                    if (data.hasOwnProperty(prop)) {
                        var msg = data[prop];
                        if (msg.indexOf('Sample log message') !== -1) {
                            done();
                        }
                    }
                }
            };
            var notifier = processors.processFile(fileDesc);
            notifier.on('end', function(err) {
                if (err) {
                    assert.fail(err, null, 'No error was expected');
                }
            });
        });

        it('processing-error', function(done) {
            var tmpFile = tmp.fileSync();
            var fileDesc = {'metric': 'processing-error', 'category': 'processing-error', path: tmpFile.name};
            var notifier = processors.processFile(fileDesc);
            var errorEventOk;
            notifier.on('end', function(err) {
                if (!errorEventOk) {
                    assert.fail(null, null, 'Expected an "error" event before "end" event');
                }
                if (!err) {
                    assert.fail(null, null, 'Expected an error');
                } else {
                    assert.strictEqual(err.code, 1, 'Expected result code 1');
                    done();
                }
            });
            notifier.on('error', function(err) {
                // the opening [ is not closed due to error, therefore JSON parser reports an error. It will be
                // followed by end event with error having result code on it
                assert(err.message.indexOf('Parser has expected a value') !== -1, 'Expected "Parser has expected a value" error');
                errorEventOk = true;
            });
        });

        it('unique-names', function(done) {
            // processor descriptor uses unique values for metric, category, processor name
            // processor returns empty array therefore no data event will be emited
            var tmpFile = tmp.fileSync();
            var fileDesc = {'metric': 'unique-names2', 'category': 'unique-names3', path: tmpFile.name};
            var notifier = processors.processFile(fileDesc);
            var dataSeen;
            notifier.on('end', function(err) {
                if (dataSeen) {
                    assert.fail(null, null, 'No data was expected to be seen');
                }
                if (err) {
                    assert.fail(null, null, 'Unexpected error');
                } else {
                    done();
                }
            });
            notifier.on('data', function(data) {
                dataSeen = true;
            });
        });

        it('produce-two-objects', function(done) {
            var tmpFile = tmp.fileSync();
            fs.writeSync(tmpFile.fd, 'send me JSON objects');
            fs.closeSync(tmpFile.fd);
            var fileDesc = {'metric': 'produce-two-objects-metric', 'category': 'produce-two-objects-category', path: tmpFile.name};
            var notifier = processors.processFile(fileDesc);
            var dataSeen = 0;
            notifier.on('end', function(err) {
                assert.strictEqual(dataSeen, 2, '2x data was expected to be seen');
                if (err) {
                    assert.fail(null, null, 'Unexpected error');
                } else {
                    done();
                }
            });
            // data is JSON object
            notifier.on('data', function(data) {
                dataSeen++;
                assert.strictEqual(data.metric, 'produce-two-objects-metric' + dataSeen, 'Expected correct metric value');
                assert.strictEqual(data.category, 'produce-two-objects-category' + dataSeen, 'Expected correct category value');
            });
        });

        it('produce-many-objects', function(done) {
            var tmpFile = tmp.fileSync();
            fs.writeSync(tmpFile.fd, 'send me JSON objects');
            fs.closeSync(tmpFile.fd);
            var fileDesc = {'metric': 'produce-many-objects-metric', 'category': 'produce-many-objects-category', path: tmpFile.name};
            var notifier = processors.processFile(fileDesc);
            var dataSeen = 0;
            notifier.on('end', function(err) {
                assert.strictEqual(dataSeen, 1000, '1000x data was expected to be seen');
                if (err) {
                    assert.fail(null, null, 'Unexpected error');
                } else {
                    done();
                }
            });
            // data is JSON object
            notifier.on('data', function(data) {
                dataSeen++;
                assert.strictEqual(data.metric, 'produce-many-objects-metric' + dataSeen, 'Expected correct metric value');
                assert.strictEqual(data.category, 'produce-many-objects-category' + dataSeen, 'Expected correct category value');
            });
        });

        it('error in data handler', function(done) {
            // due to error in 'data' handler there will be only one 'data' event fired, followed by 'end' event
            var tmpFile = tmp.fileSync();
            fs.writeSync(tmpFile.fd, 'send me JSON objects');
            fs.closeSync(tmpFile.fd);
            var fileDesc = {'metric': 'produce-two-objects-metric', 'category': 'produce-two-objects-category', path: tmpFile.name};
            var notifier = processors.processFile(fileDesc);
            var dataSeen = 0;
            var errorSeen;
            notifier.on('end', function(err) {
                assert.strictEqual(dataSeen, 1, '1x data was expected to be seen');
                if (!err) {
                    assert.fail(null, null, 'Error was expected in end event');
                } else {
                    done();
                }
            });
            // data is JSON object
            notifier.on('data', function(data) {
                dataSeen++;
                throw new Error('test error in data handler');
            });
            notifier.on('error', function(err) {
                errorSeen = true;
                assert(err.message.indexOf('test error in data handler') !== -1, 'Expected "test error in data handler" error');
            });
        });

        it('produce-invalid-objects', function(done) {
            // due to error in 'data' handler there will be only one 'data' event fired, followed by 'end' event
            var tmpFile = tmp.fileSync();
            fs.writeSync(tmpFile.fd, 'send me JSON objects');
            fs.closeSync(tmpFile.fd);
            var fileDesc = {'metric': 'produce-invalid-objects-metric', 'category': 'produce-invalid-objects-category', path: tmpFile.name};
            var notifier = processors.processFile(fileDesc);
            var dataSeen = 0;
            var errorSeen;
            notifier.on('end', function(err) {
                assert.strictEqual(dataSeen, 1, '1x data was expected to be seen');
                if (!err) {
                    assert.fail(null, null, 'Error was expected in end event');
                } else {
                    done();
                }
            });
            // data is JSON object
            notifier.on('data', function(data) {
                // should be invoked only 1x
                dataSeen++;
                assert.strictEqual(data.metric, 'produce-invalid-objects-metric' + dataSeen, 'Expected correct metric value');
                assert.strictEqual(data.category, 'produce-invalid-objects-category' + dataSeen, 'Expected correct category value');
            });
            notifier.on('error', function(err) {
                errorSeen = true;
                assert(err.message.indexOf('expected an object key') !== -1, 'Expected "expected an object key error');
            });
        });

        afterEach(function() {
            customLogAppender = null;
        });

        function findProcessorDesc(processorName) {
            for (var prop in processorDescs) {
                if (processorDescs.hasOwnProperty(prop)) {
                    var processorDesc = processorDescs[prop];
                    if (processorDesc.name === processorName) {
                        return processorDesc;
                    }
                }
            }
            return null;
        }
    });
});
