'use strict';
var chai = require("chai");
var assert = chai.assert;
var amqp = require('amqplib');
var when = require('when');
var uuid = require('node-uuid');
var notification = require("./../../service/notification");

describe('notification tests', function() {
    var amqConn;
    var amqCh;
    var msgConsumer;

    before(function(done) {
        var processorDescs = [{
            'name': 'testProcessor1',
            'consumes': [{'metric': 'testMetric1', 'category': 'testCategory1'}]
        }, {
            'name': 'testProcessor2',
            'consumes': [{'metric': 'testMetric2', 'category': 'testCategory2'}, {'metric': 'testMetric3', 'category': 'testCategory3'}]
        }];
        var promise1 = notification.initAmq(processorDescs, function(msg, ackControl) {
            if (msgConsumer) {
                msgConsumer(msg, ackControl);
            } else {
                console.warn('msgConsumer is not set. Unexpected message ' + msg.content.toString());
                ackControl.ack();
            }
        }).then(null, function onError(err) {
            assert.fail(err, null, 'Failed to init notification module');
        });
        var promise2 = amqp.connect(getAmqUrl()).then(function(conn) {
            amqConn = conn;
            return conn.createConfirmChannel();
        });
        promise2 = promise2.then(function(ch) {
            amqCh = ch;
            return ch.assertExchange('result-upload', 'direct', {durable: true});
        });
        when.all([promise1, promise2]).done(function onOk() {
            done();
        }, function onError(err) {
            assert.fail(err, null, 'Failed to connect to AMQ');
        })
    });

    it('Send notification for testMetric1/testCategory1', function(done) {
        var name = uuid.v4();
        msgConsumer = function(msg, ackControl) {
            var contentStr = msg.content.toString();
            var fileDescriptor = JSON.parse(contentStr);
            assert.strictEqual(fileDescriptor.metric, 'testMetric1');
            assert.strictEqual(fileDescriptor.category, 'testCategory1');
            assert.strictEqual(fileDescriptor.name, name);
            ackControl.ack();
            done();
        };
        send({'metric': 'testMetric1', 'category': 'testCategory1', name: name}, function (err) {
            if (err) {
                assert.fail(err, null, 'Failed to send notification');
            }
        });
    });

    it('Nack then ack for testMetric1/testCategory1', function(done) {
        // message will get redelivered 2nd time after nack
        var name = uuid.v4();
        var counter = 0;
        msgConsumer = function(msg, ackControl) {
            var contentStr = msg.content.toString();
            var fileDescriptor = JSON.parse(contentStr);
            assert.strictEqual(fileDescriptor.metric, 'testMetric1');
            assert.strictEqual(fileDescriptor.category, 'testCategory1');
            assert.strictEqual(fileDescriptor.name, name);
            if (counter++ === 0) {
                ackControl.nack();
            } else {
                ackControl.ack();
                done();
            }
        };
        send({'metric': 'testMetric1', 'category': 'testCategory1', name: name}, function (err) {
            if (err) {
                assert.fail(err, null, 'Failed to send notification');
            }
        });
    });

    it('Send notification for testMetric2/testCategory2', function(done) {
        var name = uuid.v4();
        msgConsumer = function(msg, ackControl) {
            var contentStr = msg.content.toString();
            var fileDescriptor = JSON.parse(contentStr);
            assert.strictEqual(fileDescriptor.metric, 'testMetric2');
            assert.strictEqual(fileDescriptor.category, 'testCategory2');
            assert.strictEqual(fileDescriptor.name, name);
            ackControl.ack();
            done();
        };
        send({'metric': 'testMetric2', 'category': 'testCategory2', name: name}, function (err) {
            if (err) {
                assert.fail(err, null, 'Failed to send notification');
            }
        });
    });

    it('Send notification for testMetric3/testCategory3', function(done) {
        var name = uuid.v4();
        msgConsumer = function(msg, ackControl) {
            var contentStr = msg.content.toString();
            var fileDescriptor = JSON.parse(contentStr);
            assert.strictEqual(fileDescriptor.metric, 'testMetric3');
            assert.strictEqual(fileDescriptor.category, 'testCategory3');
            assert.strictEqual(fileDescriptor.name, name);
            ackControl.ack();
            done();
        };
        send({'metric': 'testMetric3', 'category': 'testCategory3', name: name}, function (err) {
            if (err) {
                assert.fail(err, null, 'Failed to send notification');
            }
        });
    });

    after(function(done) {
        var promise1 = notification.shutdown().then(null, function onError(err) {
            assert.fail(err, null, 'Failed to shut down notification module');
        });
        when.all([promise1, amqConn.close()]).done(function onOk() {
            done();
        }, function onError(err) {
            assert.fail(err, null, 'Failed to disconnect from AMQ');
        })
    });

    function getAmqUrl() {
        if (!process.env.AMQ_USER) {
                throw new Error('AMQ_USER environment variable is not specified');
        }
        if (!process.env.AMQ_PASSWORD) {
                throw new Error('AMQ_PASSWORD environment variable is not specified');
        }
        var amq_hostname = process.env.AMQ_HOSTNAME || 'amqserver';
        var amq_port = process.env.AMQ_PORT || '5672';

        return 'amqp://' + process.env.AMQ_USER + ':' + process.env.AMQ_PASSWORD +
                    '@' + amq_hostname + ':' + amq_port + '?frameMax=0x1000&heartbeat=30';
    }

    function send(fileMetadata, callback) {
        if (!amqCh) {
            throw new Error('Notification channel is not ready');
        }
        amqCh.publish('result-upload', getRoutingKey(fileMetadata), new Buffer(JSON.stringify(fileMetadata)),
                {mandatory: true, persistent: true}, callback);
    }

    function getRoutingKey(fileMetadata) {
        return fileMetadata.metric + '/' + fileMetadata.category;
    }

});
