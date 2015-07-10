# result-processing

Result processing component consists of two parts:
- result processors
- service which receives RabbitMQ notifications, executes result processors and sends processed results to metrics gateway service

## Result processors

- each result processor is located in its own directory
- are executed as independent processes (thus eliminating problem with memory leaks)
- can be implemented in any programing language
- come with file named "processor-descriptor.json" which defines processor name, program to execute and declaration of what data it is capable of processing
- receive parameters as environment variables prefixed with "p_". The following environment variables can be expected: "p_metric", "p_category", "p_name", "p_source", "p_timestamp", "p_contentType". Parameters "p_source", "p_timestamp" are optional. "p_contentType" is always present and represents the HTTP Content-Type header value.
- receive uploaded file on STDIN. The file can be binary or textual (i.e XML, JSON) and in theory can be quite big. It is not recommended to parse it at once. Processing ends when EOF is received from STDIN.
- processed results are written to STDOUT in the form of JSON array containing JSON objects. JSON objects must have format expected by metrics-gateway-service ("/mgs/rest/v1/gateway/publish"). It is recommended to write JSON objects to STDOUT while processing STDIN.
- log can be written to STDERR (of all log levels, not just errors). It ends up in result upload service log under processor name.
- must exit with 0 if there was no error, 1 if there was a general error
- should support SIGTERM to terminate processing. After SIGTERM is sent, any output produced will be ignored by result processing service
- must support execution when STDIN is closed immediately, no "p_" parameters are present and exit with 0. This is used by result processing service to verify that the processor can be executed successfully.

Result processors receive parameters as environment variables instead of process arguments as process arguments are platform specific - i.e Java applications would receive arguments using -D parameter while shell script could read arguments directly. Since result processing service is not aware of application specifics, it can't know how to pass arguments to make them accessible in the application.

Sample processor-descriptor.json:
{
  "name": "dummy",
  "command": "node processor.js",
  "consumes" : [{"metric": "dummy", "category": "dummy"}]
}

Processor name must be unique and represent what kind of data it can process. "consumes" represents the data it can receive and process. Semantics of "metric" and "category" are defined by metrics gateway service. One processor can support processing multiple types of data and multiple content types. Processor debugging can be done by specifying argument to enable program debugging (in Java, Node.js) and have program execution paused until debugger connects.

Processor implementations should be located in the "processors" directory in their own subdirectories. See processor directories in "tests/system" which are used in tests.

## Result processing service

- connects to RabbitMQ and creates binding from "result-upload" exchange to queues named like result processors based on metric/category. Each result processor has its own queue.
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

Each result processing service instance may be started with different set of processors or with just one processor.

## Configuration

Supported environment parameters:
- AMQ_USER, AMQ_PASSWORD for authenticating to RabbitMQ. This is temporary until a better way to retrieve credentials by services is available.
- PROCESSORS_PATH - path where result processors can be found. If not specified, "processors" directory is used
- MSGW_PORT - port for metrics gateway. If not specified, 8080 is used
- METRICS_BATCH_SIZE - batch size to use when sending data to metrics gateway

## Building

Gruntfile.js is used for running tests, JSHint, JSDoc.

For building production image distribution/release/Dockerfile is used. Local shell script setup.sh is used to execute statements requiring proxy (i.e npm install).

Example:
- docker build -t gaiaadm/result-processing:0.1 -f distribution/release/Dockerfile .

For building image for development purposes, distribution/dev/Dockerfile can be used. The dev image is meant to be used for starting "nodemon server.js" which will automatically reload Node.js server after file change. The dev image doesn't start node.js automaticlly, instead it just starts shell. It also expects npm dependencies are already available. In dev environment one would setup mapping of "/src" to host file system.

## Running

Execute:
- docker run -d -e AMQ_USER="admin" -e AMQ_PASSWORD="mypass" -v "/tmp:/upload" --link rabbitmq:amqserver --link mgs:metricsgw --name result-processing gaiaadm/result-processing:0.1

Unless at least one processor is available the process will exist immediately. Note that the mount point for uploads must be the same in both result upload service and result processing service docker image. For development purposes usage of /tmp is sufficient. For production it needs to be NFSv4 volume. Linking requires knowledge of container name/id we are linking to (i.e "mgs", "rabbitmq" in example).

## Known issues

- we don't handle reconnection to RabbitMQ, handle AMQ channel recreation
- notification message is acked both in case of success and error during processing. This is done to avoid infinite message redelivery. It should be enhanced by storing the notification in some DB for files with errors and only then acking the message. This would allow us to process the file again later or have it deleted without processing (if invalid).
- currently there is no way for processor to tell the service version of the produced content. All result processors must thus produce data of the same version. Metrics gateway service may support multiple data format versions (i.e v1, v2 on its REST). If case of change we have to update code of all result processors.
- lack of versioning support in processors. New versions could add support for parsing new versions of the same data (metric/category) or new types of data (new metrics/categories). Support for versioning would mean processors declaring version for each metric/category in "consumes". Then instead of queue per processor name there would be queue per each version of metric/category. Result processing service would listen only on queues its processors can handle. Such deployment could have mixed versions of processors. The downside is higher number of queues - one per each metric/category key and this results in more processes in RabbitMQ.
