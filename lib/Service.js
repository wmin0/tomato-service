"use strict";

var path = require('path');
module.exports = Service;

var Service = function(args) {
  this.instance = args.instance;
  this.name = args.name;
  this.type = args.type;
  this.options = args.options;
  this.connected = {};
  Object.defineProperty(this.instance, '_name', {
    configurable: false,
    enumerable: false,
    value: args.name,
    writable: false
  });
  Object.defineProperty(this.instance, '_type', {
    configurable: false,
    enumerable: false,
    value: args.type,
    writable: false
  });
  Service.maybeCreateSyncDataPrivate(this.instance);
  // start monitor
  this.syncObserver = this.syncObserver.bind(this);
  Object.observe(this.instance._sync, this.syncObserver);
}

Service.prototype.getServiceObject = function() {
  var ret = {};
  for (var key in this.instance) {
    if (this.instance[key].hasOwnProperty('_clientProperty')) {
      ret[key] = this.instance[key]['_clientProperty'];
    }
  }
  ret._sync = this.instance._sync;
  return ret;
};

Service.prototype.serviceCall = function(args, callback) {
  var func = this.instance[args.method];
  if (!func || !func.hasOwnProperty('_clientProperty')) {
    return;
  }
  // TODO: error
  var resp = func.call(this.instance, args.args, args.id);
  if (callback) {
    callback(resp);
  }
};

Service.prototype.serviceSync = function(args, callback) {
  // TODO: error
  if (!(args.key in this.instance._sync)) {
    return;
  }
  if (callback) {
    callback(true);
  }
  this.instance._sync[args.key] = args.data;
  //console.log('serviceSync done');
}

Service.prototype.connect = function(socket) {
  // TODO: event
  var id = socket.id + (Math.floor(Math.random() * 10000));
  this.connected[id] = socket;
  socket.services[this.name] = this;
  return {
    name: this.name,
    type: this.type,
    id: id,
    client: this.getServiceObject()
  };
}

Service.prototype.disconnectId = function(id) {
  // TODO: event
  this.connected[id] = undefined;
}

Service.prototype.disconnectSocket = function(socket) {
  var ids = this.getConnectedIds(socket);
  ids.forEach(function(id) {
    this.disconnectId(id);
  }, this);
}

Service.prototype.getConnectedIds = function(socket) {
  var matchReg = new RegExp('^' + socket.id);
  return Object.keys(this.connected).filter(function(id) {
    return id.match(matchReg);
  });
}

Service.prototype.destroy = function() {
  if (typeof this.instance.destroy === 'function') {
    this.instance.destroy.call(this.instance);
  }
  // stop monitor
  Object.unobserve(this.instance._sync, this.syncObserver);
  this.instance = null;
}

Service.prototype.syncObserver = function(changes) {
  changes.forEach(function(change) {
    Object.keys(this.connected).forEach(function(key) {
      this.connected[key].emit('service:sync', {
        name: this.name,
        type: this.type,
        id: key,
        op: change.type,
        key: change.name,
        data: change.object[change.name]
      });
    }, this);
  }, this);
}

Object.defineProperty(Service.prototype, 'connectedNumber', {
  configurable: false,
  enumerable: true,
  set: undefined,
  get: function() {
    return Object.keys(this.connected).filter(function(key) {
      return this.connected[key];
    }, this).length;
  }
});

Service.instance = {};
Service.basePath = undefined;

Service.getService = function(args) {
  var service = Service.instance[args.name];
  if (service && (service.type == args.type)) {
    return service;
  }
  if (service) {
    return 'conflict type';
  }
  return null;
};

Service.setService = function(name, service) {
  Service.instance[name] = service;
}

Service.clientFunction = function(method) {
  var func = function(args, id, callback) {
    //console.log('call client', this, arguments);
    var service = Service.getService({
      name: this._name,
      type: this._type
    });
    if (typeof service !== 'object') {
      // TODO:
      return;
    }
    if (id !== undefined) {
      var socket = service.connected[id];
      if (!socket) {
        return;
      }
      socket.emit('service:request', {
        name: service.name,
        type: service.type,
        id: id,
        args: args,
        method: method
      }, function(resp) {
        if (typeof callback === 'function') {
          callback.call(this, resp);
        }
      }.bind(this));
    } else {
      Object.keys(service.connected).forEach(function(key) {
        service.connected[key].emit('service:request', {
          name: service.name,
          type: service.type,
          id: key,
          args: args,
          method: method
        });
      });
    }
  };
  Object.defineProperty(func, '_clientProperty', {
    configurable: false,
    enumerable: false,
    value: 'override',
    writable: false
  });
  return func;
};

Service.clientCallable = function(func) {
  Object.defineProperty(func, '_clientProperty', {
    configurable: false,
    enumerable: false,
    value: 'callable',
    writable: false
  });
  return func;
};

Service.maybeCreateSyncDataPrivate = function(instance) {
  if (instance._sync) {
    return;
  }
  Object.defineProperty(instance, '_sync', {
    configurable: false,
    enumerable: false,
    value: {},
    writable: false
  });
}

Service.createSyncData = function(instance, key, data) {
  Service.maybeCreateSyncDataPrivate(instance);

  instance._sync[key] = data;

  Object.defineProperty(instance, key, {
    configurable: true,
    enumerable: true,
    get: function() { return this._sync[key]; },
    set: function(s) { return (this._sync[key] = s); }
  });
};

Service.deleteSyncData = function(instance, key) {
  if (!instance._sync) {
    return;
  }

  delete instance._sync[key];
  delete instance[key];
};

Service.loadService = function(args) {
  if (Service.basePath === undefined) {
    throw "You Should Set Service Base";
    return;
  }
  var service = null;
  try {
    var module = require(path.join(Service.basePath, args.type));
    Object.keys(module.prototype).forEach(function(key) {
      if (module.prototype[key] === Service.clientFunction) {
        module.prototype[key] = Service.clientFunction(key);
      }
    });
    //console.log('create service');
    service = new Service({
      instance: new module(),
      type: args.type,
      name: args.name,
      options: Service.serviceOptions
    });
    Service.setService(args.name, service);
  } catch (e) {
    console.log('loadService Err', e);
  }
  return service;
}

Service.connectService = function(socket, args) {
  var service = Service.getService(args);
  if (service === null) {
    service = Service.loadService(args);
  } else if (typeof service == 'string'){
    return service;
  }
  if (service) {
    service = service.connect(socket);
  } else {
    service = 'load service fail';
  }
  return service;
}

Service.getThisConnected = function(instance) {
  var service = Service.getService({
    name: instance._name,
    type: instance._type
  });
  if (typeof service !== 'object') {
      // TODO:
    return undefined;
  }
  return Object.keys(service.connected);
}

Service.garbageCollection = function() {
  var todo = Object.keys(Service.instance).filter(function(name) {
    var service = Service.instance[name]
    return (service) &&
           (0 === service.connectedNumber) &&
           (!service.options || (!service.options.standalone));
  });
  todo.forEach(function(name) {
    var service = Service.instance[name];
    Service.instance[name].destroy();
    Service.instance[name] = undefined;
  });
}

module.exports = Service;
