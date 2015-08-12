'use strict';

var paramCount = 0;
var keys = Object.keys(process.env);
for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (key.lastIndexOf('P_', 0) === 0) {
        var value = process.env[key];
        paramCount++;
    }
}

if (paramCount === 0) {
    // this gets executed during init to verify processor execution works (command is correct)
    process.exit(0);
} else {
    // this gets executed during processing
    console.log('[');
    process.exit(1);
}
