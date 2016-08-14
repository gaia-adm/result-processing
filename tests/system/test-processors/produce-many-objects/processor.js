'use strict';

// produce 1000 JSON objects after receiving expected input on STDIN. Produced JSON objects will contain parameters.
function getParams() {
    var params = {};
    var keys = Object.keys(process.env);
    for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        if (key.lastIndexOf('P_', 0) === 0) {
            var value = process.env[key];
            params[key.substr(2)] = value;
        }
    }
    return params;
}
var params = getParams();

console.log('[');

// stdin can also be binary, encoding must be set to avoid getting wrong utf8 strings in data event
process.stdin.setEncoding('utf8');
process.stdin.on('data', function(str) {
    console.error('received "' + str + '"');
    if (str.indexOf('send me JSON objects') !== -1) {
        for (var i = 1; i < 1001; i++) {
            var object = {};
            for (var prop in params) {
                if (params.hasOwnProperty(prop)) {
                    object[prop] = params[prop] + i;
                }
            }
            if (i > 1) {
                console.log(',');
            }
            console.log(JSON.stringify(object));
        }
    }
});
process.stdin.on('end', function() {
    console.log(']');
    setTimeout(function(){ //unless there is a timeout, the process exits before it sends all the data
        process.exit(0);
    }, 1000);
});
