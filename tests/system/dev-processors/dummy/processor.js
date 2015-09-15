'use strict';

var logLevelsMap = {
    'DEBUG': 1, 'INFO': 2, 'WARNING': 3, 'ERROR': 4, 'CRITICAL': 5
};

log('DEBUG', 'processor.js', 'Some sample logging');

var paramCount = 0;
log('DEBUG', 'processor.js', 'Process parameters:');
var keys = Object.keys(process.env);
for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (key.lastIndexOf('P_', 0) === 0) {
        var value = process.env[key];
        paramCount++;
        log('DEBUG', 'processor.js', key.substr(2) + ' = ' + value);
    }
}

log('DEBUG', 'processor.js', 'Process stdin:');
process.stdin.setEncoding('utf8');
process.stdin.on('data', function(str) {
    log('DEBUG', 'processor.js', str);
});
process.stdin.on('end', function() {
    process.exit(0);
});

console.log('[');
for (var i = 0; i < 50; i++) {
    if (i > 0) {
        console.log(',');
    }
    console.log(JSON.stringify({
      "event": "general",
      "time": new Date().toISOString(),
      "source": {
        "origin": "notyourbusiness"
      },
      "tags": {
        "tag1": "foo",
        "tag2": "boo"
      },
      "data": {
        "field1": "value1",
        "field2": "value2",
        "field3": 3
      }
    }));
}
console.log(']');

function log(level, location, message) {
    var logLevel = logLevelsMap[level];
    var configuredLogLevel = logLevelsMap[process.env.P_LOG_LEVEL || 'DEBUG'];
    if (logLevel >=  configuredLogLevel) {
        console.error(level + ':' + location + ':' + message);
    }
}
