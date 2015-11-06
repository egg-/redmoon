var util = require('util')
var events = require('events')
var shortid = require('shortid')
var NRP = require('node-redis-pubsub')

function Redmoon (config) {
  events.EventEmitter.call(this)

  this._client = null
  this._nrp = null

  this.config = {
    scope: 'redmoon',
    name: 'default',
    host: '127.0.0.1',
    port: 6379,
    timeout: 5000 // 5 sec
  }
  this.key = {
    meta: [this.config.scope, 'meta'].join(':'), // hash
    cycle: [this.config.scope, 'cycle'].join(':') // set (sorted)
  }
}

util.inherits(Redmoon, events.EventEmitter)

Redmoon.prototype.connect = function (config) {
  this.end()

  config = config || this.config

  typeof config.scope !== 'undefined' && (this.config.scope = config.scope)
  typeof config.name !== 'undefined' && (this.config.name = config.name)
  typeof config.host !== 'undefined' && (this.config.host = config.host)
  typeof config.port !== 'undefined' && (this.config.port = config.port)
  typeof config.timeout !== 'undefined' && (this.config.timeout = config.timeout)

  this._client = require('redis').createClient(this.config.port, this.config.host)
  this._nrp = new NRP(this.config)

  this.events()

  return this
}

Redmoon.prototype.events = function () {
  var self = this
  var events = ['error', 'ready', 'connect', 'end']

  for (var i = 0; i < events.length; i++) {
    this._client.on(events[i], (function (evt) {
      return function () {
        var args = Array.prototype.slice.call(arguments)

        args.unshift(evt)
        self.emit.apply(self, args)
      }
    }(events[i])))
  }

  return this
}

Redmoon.prototype.load = function (cb, key, page, limit) {
  var self = this
  var uuid = Redmoon.uuid(key)

  page = page || 1
  limit = limit || 10

  // check exist search result on meta
  this._client.send_command('HSCAN', [this.key.meta, 0, 'MATCH', uuid + ':*'], function (err, metas) {
    if (err) {
      return cb(err)
    }

    if (metas[1].length > 0) {
      var start = (page - 1) * limit
      var end = start + limit - 1

      self._client.lrange([self.config.scope, self.config.name, uuid].join(':'), start, end, function (err, items) {
        if (err) {
          return cb(err)
        }

        for (var i = 0, len = items.length; i < len; i++) {
          items[i] = JSON.parse(items[i])
        }

        cb(null, items, metas[1])
      })
    } else {
      var topic = [shortid.generate(), self.config.name, 'result', uuid].join(':')
      var timeout = null

      timeout = setTimeout(function () {
        self._nrp.off(topic)
        self.emit('timeout', key)

        cb('redmoon.timeout')
      }, self.config.timeout)

      self._nrp.on(topic, function (data) {
        timeout && clearTimeout(timeout)

        self._nrp.off(topic)
        self.load(cb, key, page, limit)
      })
      self._nrp.emit([self.config.name, uuid].join(':'), { key: key, topic: topic })
    }
  })

  return this
}

Redmoon.prototype.add = function (cb, moon, meta, items) {
  var uuid = Redmoon.uuid(moon.key)

  var multi = this._client.multi()
    .zadd(this.key.cycle, Redmoon.unix(), uuid)
    .hset(this.key.meta, [uuid, meta.provider || shortid.generate()].join(':'), JSON.stringify(meta))

  for (var i = 0, len = items.length; i < len; i++) {
    multi.rpush([this.config.scope, this.config.name, uuid].join(':'), JSON.stringify(items[i]))
  }

  multi.exec(function (err) {
    cb(err)
  })

  return this
}

Redmoon.prototype.subscribe = function (cb) {
  this._nrp.on(this.config.name + ':*', cb)
}

Redmoon.prototype.unsubscribe = function (cb) {
  this._nrp.off(this.config.name + ':*', cb)
}

Redmoon.prototype.trigger = function (topic, data) {
  this._nrp.emit(topic, data || {})
}

Redmoon.prototype.end = function () {
  if (this._client) {
    this._client.end()
    this._client = null
  }

  if (this._nrp) {
    this._nrp.end()
    this._nrp = null
  }
}

Redmoon.uuid = function (key) {
  return encodeURIComponent(key.replace(/:/gi, '-'))
}

Redmoon.unix = function () {
  return Math.floor((+new Date()) / 1000)
}

Redmoon.create = function (config) {
  return (new Redmoon()).connect(config || {})
}

module.exports = Redmoon
