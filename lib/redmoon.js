var util = require('util')
var events = require('events')
var shortid = require('shortid')
var NRP = require('node-redis-pubsub')

function Redmoon (config) {
  events.EventEmitter.call(this)

  this._client = null
  this._nrp = null

  this._timer = null

  this.config = {
    scope: 'redmoon',
    name: 'default',
    host: '127.0.0.1',
    port: 6379,
    timeout: 5000, // 5 sec
    buffer: 100, // buffer count for preloading
    ttl: 5, // max time for atomic
    interval: 60 // interval value for garbage collection
  }
  this.key = {
    atomic: [this.config.scope, 'atomic'].join(':'), // hash
    meta: [this.config.scope, 'meta'].join(':'), // hash
    cycle: [this.config.scope, 'cycle'].join(':') // set (sorted)
  }

  this.garbage = {
    start: function (offset) {
      this._timer = setInterval(function () {
        this.truncate(Redmoon.unix() - offset)
      }.bind(this), this.config.interval * 1000)
    }.bind(this),
    stop: function () {
      clearInterval(this._timer)
      this._timer = null
    }.bind(this)
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
  typeof config.buffer !== 'undefined' && (this.config.buffer = config.buffer)
  typeof config.ttl !== 'undefined' && (this.config.ttl = config.ttl)
  typeof config.interval !== 'undefined' && (this.config.interval = config.interval)

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
  this.loadMeta(function (err, metas) {
    if (err) {
      return cb(err)
    }

    if (metas.length > 0) {
      var start = (page - 1) * limit
      var end = start + limit - 1

      self._client.lrange([self.config.scope, self.config.name, uuid].join(':'), start, end, function (err, items) {
        if (err) {
          return cb(err)
        }

        // migrate items
        for (var i = 0, len = items.length; i < len; i++) {
          items[i] = JSON.parse(items[i])
        }

        // migrate meta
        var meta = {}
        var loadedcount = 0
        for (var j = 1, parsed = null; j < metas.length; j += 2) {
          parsed = JSON.parse(metas[j])
          meta[parsed.provider] = parsed
          loadedcount += (parsed.page - 1) * (parsed.limit || 0)
        }

        // required collection
        if (end + self.config.buffer > loadedcount) {
          self._nrp.emit([self.config.scope, self.config.name, 'request', uuid].join(':'), {
            uuid: uuid,
            key: key,
            topic: self.toTopic(uuid),
            meta: meta
          })
        }

        cb(null, items, meta)
      })
    } else {
      var timeout = null
      var topic = self.toTopic(uuid)

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
      self._nrp.emit([self.config.scope, self.config.name, 'request', uuid].join(':'), {
        uuid: uuid,
        key: key,
        topic: topic
      })
    }
  }, uuid)

  return this
}

Redmoon.prototype.loadMeta = function (cb, uuid, count) {
  this._client.send_command('HSCAN', [this.key.meta, 0, 'MATCH', uuid + ':*', 'COUNT', count || 1000], function (err, metas) {
    cb(err, metas ? metas[1] : [])
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
  this._nrp.on([this.config.scope, this.config.name, 'request', '*'].join(':'), cb)
  return this
}

Redmoon.prototype.unsubscribe = function (cb) {
  this._nrp.off([this.config.scope, this.config.name, 'request', '*'].join(':'), cb)
  return this
}

Redmoon.prototype.trigger = function (topic, data) {
  this._nrp.emit(topic, data || {})
  return this
}

// atomic processing
Redmoon.prototype.atomic = function (uuid, process, complete) {
  // atomic
  var self = this
  var key = [this.key.atomic, uuid].join(':')

  this._client.get(key, function (err, item) {
    if (err) {
      return self.emit('error', err)
    }

    if (item) {
      // already requested
      return true
    }

    self._client.multi()
      .set(key, uuid)
      .expire(key, self.config.ttl)
      .exec(function (err) {
        if (err) {
          return self.emit('error', err)
        }

        process(function (err, data) {
          self._client.del([self.key.atomic, uuid].join(':'), function () {
            complete(err, data)
          })
        })
      })
  })
  return this
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
  return this
}

Redmoon.prototype.truncate = function (unix) {
  var self = this
  unix = unix || Redmoon.unix() - 3600 // default 1 hour

  this._client.zrangebyscore(this.key.cycle, 0, unix, function (err, items) {
    if (err) {
      return self.emit('error', err)
    }

    for (var i = 0; i < items.length; i++) {
      self.loadMeta((function (uuid) {
        return function (err, metas) {
          if (err) {
            return self.emit('error', err)
          }

          var multi = self._client.multi()

          for (var j = 0; j < metas.length; j += 2) {
            multi.hdel(self.key.meta, metas[j])
          }

          multi.del([self.config.scope, self.config.name, uuid].join(':'))
          multi.zrem(self.key.cycle, uuid)
          multi.exec(function (err, replies) {
            if (err) {
              return self.emit('error', err)
            }
          })
        }
      })(items[i]), items[i])
    }
  })
  return this
}

Redmoon.prototype.toTopic = function (uuid) {
  return [this.config.name, 'result', uuid].join(':')
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
