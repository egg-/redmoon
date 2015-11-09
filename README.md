# redmoon

[![js-standard-style](https://cdn.rawgit.com/feross/standard/master/badge.svg)](https://github.com/feross/standard)

## Usage

```javascript

// setting
var redmoon = require('redmoon').create(config)

redmoon.on('timeout', function(keyword) {
	console.error('redmoon timeout', keyword)
});
redmoon.on('error', function(err) {
	console.error('redmoon error', err)
});

// express
app.get('/search/:key/:page/:limit?', function (req, res) {
  redmoon.load(function (err, items, meta) {
    res.json({
      metas: meta,
      items: items
    })
  }, req.params.key, req.params.page, req.params.limit)
})

// collector
redmoon.subscribe(function (moon) {
  var provider = ['youtube', 'dailymotion']
  for (var i = 0; i < provider.length; i++) {
    search(function (err, result) {
      var meta = {
        provider: result.provider,
        totalcount: result.totalcount
      }

      redmoon.add(function (err) {
        redmoon.trigger(param.topic)
      }, moon, meta, result.items)
    }, provider[i], moon.key)
  }
})

```

## Methods

### redmoon.connect(config)

connect redis.

### redmoon.events()

initialize redmon events.
* error
* ready
* connect
* end

### redmoon.load(cb, key, page, limit)

load collected data.
if not exist data then trigger event for collection.

### redmoon.add(cb, moon, meta, items)

add collected data to cache.

### redmoon.subscribe(cb)

set callback function for the collection event.

### redmoon.unsubscribe(cb)

unset callback function for the collection event.

### redmoon.trigger(topic, data)

trigger event for the specified topic.

### redmoon.end()

close the connection to the redis server.

### Redmoon.create(config)

create Redmoon instance with config.


## Todo

* Garbage collector.
* Events for additional data collection.

## Release History

See the [changelog](CHANGELOG.md)

## LICENSE

redmoon is licensed under the MIT license.
