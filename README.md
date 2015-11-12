# redmoon

[![version](https://img.shields.io/npm/v/redmoon.svg) ![download](https://img.shields.io/npm/dm/redmoon.svg)](https://www.npmjs.com/package/redmoon)

Asynchronous broker for multi-source data collection using redis.

If redmoon.load is called, and it returned to find the data in the cache, if cache data does not exist, call the specified function(subscriber) to subscribe.

[![js-standard-style](https://cdn.rawgit.com/feross/standard/master/badge.svg)](https://github.com/feross/standard)

## Usage

```javascript

// setting
var redmoon = require('redmoon').create(config)

// event handle
redmoon
	.on('timeout', function(keyword) {
		console.error('redmoon timeout', keyword)
	})
	.on('error', function(err) {
		console.error('redmoon error', err)
	});

// express
app.get('/search/:key/:page/:limit?', function (req, res) {
  redmoon.load(function (err, items, meta) {
    res.json({
      meta: meta,
      items: items
    })
  }, req.params.key, req.params.page, req.params.limit)
})

// collector
// The first event is no meta data in moon.
redmoon
	.subscribe(subscriber)
	.garbage.start(3600)	// It deletes the data collected before to 60 minutes.

var subscriber = function (moon) {
	redmoon.atomic(moon.uuid, function(cb) {
		process(cb, moon)
	}, function(err, data) {
		complete(moon, data)
	})
}

var process = function (cb, moon) {
	// call cb when complete load data
	cb(err, {
		meta: {},
		items: {}
	})
}

var complete = function(moon, data) {
	redmoon.add(function(err) {
		redmoon.trigger(moon.topic)
	}, moon, data.meta, data.items)
}


// moon
// {
// 	uuid: uuid,
// 	key: key,
// 	topic: topic,
// 	meta: meta	// if first event then it is undefined
// }

```

## Methods

### redmoon.connect(config)

Connect redis.

### redmoon.events()

Initialize redmoon events.
* error
* ready
* connect
* end

### redmoon.load(cb(err, items, meta), key, page, limit)

Load collected data.
If not exist data then trigger event for collection.

### redmoon.loadMeta(cb(err, metas), uuid, count)

Load meta data.

### redmoon.add(cb, moon, meta, items)

Add collected data to cache.

### redmoon.subscribe(cb(err, moon))

Set callback function for the collection event.

### redmoon.unsubscribe(cb())

Unset callback function for the collection event.

### redmoon.trigger(topic, data)

Trigger event for the specified topic.

### redmoon.atomic(uuid, process(cb), complete(err, data))

The function to prevent the duplication proccess.

If it has available resources, given `process` calls and then release the resources used by `cb` call in process.
After the release, and it executes the transfer of data in `proccess` to `complete`.

### redmoon.end()

Close the connection to the redis server.

### redmoon.truncate(unix)

Deleting cache data collected before a specified time.

### redmmon.toTopic(uuid)

It converts uuid to the topic.

### redmoon.garbage.start(offset)

Start garbage collection.
Deleting cache data collected before a offset time.

### redmoon.garbage.stop()

Stop garbage collection.

### Redmoon.uuid(key)

Make unique string.

### Redmmon.uuid()

Return unixtimestamp.

### Redmoon.create(config)

Create Redmoon instance with config.


## Release History

See the [changelog](CHANGELOG.md)

## LICENSE

redmoon is licensed under the MIT license.
