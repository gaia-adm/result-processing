'use strict';

console.error('Some sample logging');

var paramCount = 0;
console.error('Process parameters:');
var keys = Object.keys(process.env);
for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (key.lastIndexOf('p_', 0) === 0) {
        var value = process.env[key];
        paramCount++;
        console.error(key.substr(2) + ' = ' + value);
    }
}

console.error('Process stdin:');
process.stdin.setEncoding('utf8');
process.stdin.on('data', function(str) {
    console.error(str);
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
