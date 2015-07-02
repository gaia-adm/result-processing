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
console.log(JSON.stringify({
    "metric": "defect",
    "category": "defect",
    "name": "1592",
    "source": "agm-919190571",
    "timestamp": new Date().getTime(),
    "measurements": [{"name": "severity", "value": 2}, {"name": "time_spent", "value": 60}]
}));
console.log(',');
console.log(JSON.stringify({
    "metric": "defect",
    "category": "defect",
    "name": "1593",
    "source": "agm-919190571",
    "timestamp": new Date().getTime(),
    "measurements": [{"name": "severity", "value": 3}, {"name": "time_spent", "value": 120}]
}));
console.log(']');
