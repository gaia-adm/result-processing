CircleCI build status: [![Circle CI](https://circleci.com/gh/gaia-adm/result-processing.svg?style=svg)](https://circleci.com/gh/gaia-adm/result-processing)

# result-processing

Result processing component consists of two parts:
- result processors
- service which receives RabbitMQ notifications, executes result processors and sends processed results to metrics gateway service

## Result processors

- each result processor is located in its own Git repository and packaged together with result processing service
- are executed as independent processes (thus eliminating problem with memory leaks)
- can be implemented in any programing language
- come with file named "processor-descriptor.json" which defines processor name, program to execute and declaration of what data it is capable of processing
- receive parameters as environment variables prefixed with "P_". The following environment variables can be expected: "P_DATATYPE", "P_CONTENTTYPE". "P_CONTENTTYPE" represents the HTTP Content-Type header value. Custom metadata from data providers will be accessible with prefix "P_C_". Note that received parameter keys will always be uppercase regardless of the case used during data collection. This is to ensure compatibility between Windows (dev) and Linux (production) environments. Parameter values are case sensitive.
- receive uploaded file on STDIN. The file can be binary or textual (i.e XML, JSON) and in theory can be quite big. It is not recommended to parse it at once. Processing ends when EOF is received from STDIN.
- processed results are written to STDOUT in the form of JSON array containing JSON objects. JSON objects must have format expected by metrics-gateway-service ("/mgs/rest/v1/gateway/event"). It is recommended to write JSON objects to STDOUT while processing STDIN.
- log can be written to STDERR. It ends up in result upload service log under processor name.
  - logging format is "LEVEL:LOCATION:MESSAGE", where LEVEL can be one of DEBUG,INFO,WARNING,ERROR,CRITICAL. Alternative format is just "MESSAGE", which is assumed to be an error (unexpected errors). Each message must be terminated by newline. The logging format matches Python logger basic configuration and levels match Python logger log levels.
- must exit with 0 if there was no error, 1 if there was a general error
- should support SIGTERM to terminate processing. After SIGTERM is sent, any output produced will be ignored by result processing service. When SIGTERM is received, STDIN will be closed as well (which may lead to parsing error due to incomplete input). SIGTERM is then a hint to application that this state is desired.
- must support execution when STDIN is closed immediately, no "P_" parameters are present and exit with 0. This is used by result processing service to verify that the processor can be executed successfully.

Result processors receive parameters as environment variables instead of process arguments since in general its easier to process environment variables than command line arguments where CLI parsing libraries are necessary.

Sample processor-descriptor.json:
```js
{
  "name": "dummy",
  "command": "node processor.js",
  "consumes" : [{"dataType": "dummy/dummy"}]
}
```

Processor name must be unique and represent what kind of data it can process. "consumes" represents the data it can receive and process. One processor can support processing multiple types of data and multiple content types. Processor debugging can be done by specifying argument to enable program debugging (in Java, Node.js) and have program execution paused until debugger connects.

Processor implementations should be located their own Git repositories and have their own Dockerfiles extending result-processing Dockerfile. For examples see sample-weather processor and processors in "tests/system" which are used in tests. Processor Dockerfile will add the processor to "processors" directory which is empty in the parent Docker image. For development purposes this directory can be mapped to local directory while executing "docker run" and thus avoiding the need to rebuild or restart Docker image.

## Result processing service

- connects to RabbitMQ and creates binding from "result-upload" exchange to queues named like result processors dataType. Each dataType has its own queue.
- requires at least one processor to be present, otherwise the service cannot start (since it then cannot connect to RabbitMQ and there is nothing to do)
- by default processors directory is "processors", can be customized through PROCESSORS_PATH environment variable
- during startup processors subdirectories are scanned for "processor-descriptor.json" files and found processors are executed without parameters and STDIN ending immediately to verify execution. Processors exiting with non 0 code or failing to execute are ignored.
- receives notification via RabbitMQ queues for processing some newly uploaded file
  - result processor is executed with the file being gradually read and passed into STDIN of result processor process
  - result processor STDOUT is gradually read and JSON parsed
  - received JSON objects are sent in batches to metrics gateway service. Batch size can be customized via METRICS_BATCH_SIZE environment variable.
  - in case of JSON parse error or error when sending data to metrics gateway result processor termination is requested by sending SIGTERM to it
  - if processing/sending data was successful the uploaded file is deleted

Same storage path used by result upload service must be accessible to result processing service.

## Configuration

Supported environment parameters:
- AMQ_USER, AMQ_PASSWORD for authenticating to RabbitMQ. This is temporary until a better way to retrieve credentials by services is available. AMQ_PASSWORD is optional.
- AMQ_SERVER - location of RabbitMQ server in the form hostname:port
- MGS_SERVER - location of the metrics gateway in the form hostname:port
- PROCESSORS_PATH - path where result processors can be found. If not specified, "processors" directory is used
- PROCESSORS_PARALLELISM - number of data processors that can be executed in parallel. If not present, number of CPU cores is used.
- METRICS_BATCH_SIZE - batch size to use when sending data to metrics gateway

## Building

Gruntfile.js is used for running tests, JSHint, JSDoc.

For building production image distribution/release/*/Dockerfile is used. There is Dockerfile for pure Node.js service and Node.js+Python service. Local shell script setup.sh is used to execute statements requiring proxy (i.e npm install).

Example:
- docker build -t gaiaadm/result-processing -f distribution/release/Dockerfile .

For building image for development purposes, distribution/dev/Dockerfile can be used. The dev image is meant to be used for starting "nodemon server.js" which will automatically reload Node.js server after file change. The dev image doesn't start node.js automaticlly, instead it just starts shell. It also expects npm dependencies are already available. In dev environment one would setup mapping of "/src" to host file system.

## Docker images

Two Docker images are built:
- gaiaadm/result-processing:latest - intended for data processors implemented in Node.js
- gaiaadm/result-processing:latest-python - intended for data processors implemented in Python 3.4

If data processor in other language is to be implemented, a new base image needs to be created, Dockerfile needs to be added and circle.yml adjusted.

## Running

Note that normally you will be running concrete processor Docker image, not this image.

Execute:
- docker run -d -e AMQ_USER="admin" -e AMQ_SERVER="rabbitmq:5672" -e MGS_SERVER="metricsgw:8080" -v "/tmp:/upload" --link rabbitmq:rabbitmq --link mgs:metricsgw --name result-processing gaiaadm/result-processing

Unless at least one processor is available the process will exit immediately. Note that the mount point for uploads must be the same in both result upload service and result processing service docker image. For development purposes usage of /tmp is sufficient. For production it needs to be NFSv4 volume. Linking requires knowledge of container name/id we are linking to (i.e "mgs", "rabbitmq" in example).

## Limitations

- we don't handle reconnection to RabbitMQ, handle AMQ channel recreation
- notification message is acked both in case of success and error during processing. This is done to avoid infinite message redelivery. It should be enhanced by storing the notification in some DB for files with errors and only then acking the message. This would allow us to process the file again later or have it deleted without processing (if invalid).
  - related to the fact we don't store processor execution state/result
- currently there is no way for processor to tell the service version of the produced content. All result processors must thus produce data of the same version. Metrics gateway service may support multiple data format versions (i.e v1, v2 on its REST). If case of change we have to update code of all result processors.
  - if needed this could be solved by processor descriptor saying what data it produces on STDOUT and for whom
- log level is not passed to data processor, it may result in unnecessary messages being sent to STDERR then being filtered out
- no support for chaining multiple processors after each other. Celery supports this. We could use more streams than STDOUT and processor descriptor could specify where the stream output should go (i.e metrics-gateway or other processor).
