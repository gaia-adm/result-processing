'use strict';

// produce two JSON objects, 1st one is valid, 2nd is invalid
var params = {};
var paramCount = 0;
var keys = Object.keys(process.env);
for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (key.lastIndexOf('p_', 0) === 0) {
        var value = process.env[key];
        params[key.substr(2)] = value;
        paramCount++;
    }
}

console.log('[');

// stdin can also be binary, encoding must be set to avoid getting wrong utf8 strings in data event
process.stdin.setEncoding('utf8');
process.stdin.on('data', function(str) {
    console.error('received "' + str + '"');
    if (str.indexOf('send me JSON objects') !== -1) {
        var object = {};
        for (var prop in params) {
            if (params.hasOwnProperty(prop)) {
                object[prop] = params[prop] + '1';
            }
        }
        console.log(JSON.stringify(object));
        console.log(',');
        console.log('{"key":"value",'); // object suddenly ends, simulate some internal error
    }
});
process.stdin.on('end', function() {
    if (paramCount === 0) {
        console.log(']');
        process.exit(0);
    } else {
        // simulated error
        process.exit(1);
    }
});
