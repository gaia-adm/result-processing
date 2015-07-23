'use strict';

var makeSource = require("stream-json");
var Assembler = require("stream-json/utils/Assembler");

exitOnSignal('SIGTERM');

var params = getProcessParameters();

if (Object.keys(params).length > 0) {
    console.error('City: ' + params.city);
    console.error('Country: ' + params.country);
} else {
    console.log('[]');
    process.exit(0);
}

var source = makeSource();
var assembler = new Assembler();

console.log('[');

source.output.on("data", function(chunk) {
    assembler[chunk.name] && assembler[chunk.name](chunk.value);
});

source.output.on("end", function() {
    processWeather(assembler.current);
    console.log(']');
    process.exit(0);
});

process.stdin.setEncoding('utf8');
process.stdin.pipe(source.input);

/**
 * Processes weather object from <a href="http://api.openweathermap.org/data/2.5/history/city">http://api.openweathermap.org/data/2.5/history/city</a>
 */
function processWeather(weather) {
    // TODO this should ideally be done in stream way - receive individual items instead of the weather object
    if (weather.cnt > 0) {
        var list = weather.list;
        for (var i = 0; i < list.length; i++) {
            var item = list[i];
            if (i > 0) {
                console.log(',');
            }
            processWeatherItem(item);
        }
    }
}

function processWeatherItem(item) {
    console.log(JSON.stringify({
        "metric": "openweathermap",
        "category": "weather",
        "name": params.city,
        "source": "http://api.openweathermap.org/data/2.5/history/city",
        "timestamp": item.dt,
        "measurements": [
            {"name": "temp", "value": item.main.temp},
            {"name": "pressure", "value": item.main.pressure},
            {"name": "humidity", "value": item.main.humidity},
            {"name": "windspeed", "value": item.wind.speed}
        ],
        "tags": [params.country]
    }));
}

function exitOnSignal(signal) {
    process.on(signal, function() {
        console.error('Caught ' + signal + ', exiting');
        process.exit(1);
    });
}

function getProcessParameters() {
    var params = {};
    var keys = Object.keys(process.env);
    for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        if (key.lastIndexOf('p_', 0) === 0) {
            var value = process.env[key];
            params[key.substr(2)] = value;
        }
    }
    return params;
}
