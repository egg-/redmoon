// test

var config = {
  scope: 'redmoon',
  name: 'default',
  host: '127.0.0.1',
  port: 6379,
  ttl: 3600 * 12,
  timeout: 5000 // 5 sec
}

var redmoon = require('./').create(config)

redmoon.on('timeout', function (key) {
  console.log('timeout', key)
})

redmoon.subscribe(function (moon) {
  console.info('receive event for collection.', moon)

  redmoon.add(function (err) {
    redmoon.trigger(moon.topic)
  }, moon, {
    provider: 'provider'
  }, [moon.key])
})

setTimeout(function () {
  redmoon.load(function (err, result) {
    if (err) {
      return console.error('load error', err)
    }

    console.log(result)
  }, process.argv[2] || 'redmoon')
}, 500)
