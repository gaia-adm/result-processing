'use strict';
module.exports = function(grunt) {

    // Project configuration.
    grunt.initConfig({
        jshint: {
            all: ['*.js', 'service/*.js'], options: {
                jshintrc: true
            }
        }, jsdoc: {
            dist: {
                src: ['./*.js', './service/*.js'],
                jsdoc: './node_modules/.bin/jsdoc',
                options: {
                    destination: 'doc', configure: './jsdoc-conf.json'
                }
            }
        }, mochaTest: {
            unit: {
                options: {
                    reporter: 'mocha-junit-reporter',
                    captureFile: 'unit-test-results.txt',
                    reporterOptions: {
                        mochaFile: 'unit-test-results.xml'
                    }
                }, src: ['tests/unit/**/*-tests.js']
            },
            system: {
                options: {
                    reporter: 'mocha-junit-reporter',
                    captureFile: 'system-test-results.txt',
                    reporterOptions: {
                        mochaFile: 'system-test-results.xml'
                    }
                }, src: ['tests/system/**/*-tests.js']
            }
        }
    });

    grunt.loadNpmTasks('grunt-contrib-jshint');
    grunt.loadNpmTasks('grunt-mocha-test');
    grunt.loadNpmTasks('grunt-jsdoc');

    grunt.registerTask('unit', ['mochaTest:unit']);
    grunt.registerTask('system', ['mochaTest:system']);
};
