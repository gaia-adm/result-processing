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
        }
    });

    grunt.loadNpmTasks('grunt-contrib-jshint');
    grunt.loadNpmTasks('grunt-jsdoc');
};
