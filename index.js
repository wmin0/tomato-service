"use strict";

var Service = require('./lib/Service');
var fs = require('fs');
var clientSource = fs.readFileSync(require.resolve('tomato-service-client/service.js'), 'utf-8');
var clientVersion = require('tomato-service-client/package').version;
var io = null;

var handleClientSource = function(req, res) {
  var etag = req.headers['if-none-match'];
  if (etag) {
    if (clientVersion == etag) {
      res.writeHead(304);
      res.end();
      return;
    }
  }
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('ETag', clientVersion);
  res.writeHead(200);
  res.end(clientSource);
}

var attachServer = function(server) {
  var url = '/tomato/service.js';
  var handlers = server.listeners('request').slice(0);
  server.removeAllListeners('request');
  server.on('request', function(req, res) {
    if (0 === req.url.indexOf(url)) {
      handleClientSource(req, res);
    } else {
      for (var i = 0; i < handlers.length; ++i) {
        handlers[i].call(server, req, res);
      }
    }
  });
}

exports.setBasePath = function(path) {
  Service.basePath = path;
}

exports.initSocket = function(sockets) {
  io = sockets;
  attachServer(io.httpServer);
  io.on('connection', function(socket) {
    socket.services = {};
    // name, type
    socket.on('service:connect', function(args, callback) {
      console.log('service:connect', args);
      var service = Service.connectService(socket, args);
      callback(service);
    });
    // name, type, id
    socket.on('service:disconnect', function(args, callback) {
      var service = socket.services[args.name];
      if (!service) {
        return;
      }
      service.disconnectId(args.id);
      if (0 === service.getConnectedIds(socket).length) {
        socket.services[args.name] = undefined;
      }
      Service.garbageCollection();
    });
    // name, type, id, method, args
    socket.on('service:request', function(args, callback) {
      var service = Service.getService(args);
      if (typeof service !== 'object') {
        console.log('get service fail');
        return;
      }
      service.serviceCall(args, callback);
    });
    // name, type, id, op, key, data
    socket.on('service:sync', function(args, callback) {
      var service = Service.getService(args);
      if (typeof service !== 'object') {
        console.log('get service fail');
      }
      service.serviceSync(args, callback);
    });
    socket.on('disconnect', function() {
      Object.keys(socket.services).forEach(function(name) {
        socket.services[name].disconnectSocket(socket);
      });
      Service.garbageCollection();
    });
  });
  return io;
};

exports.clientFunction = Service.clientFunction;
exports.clientCallable = Service.clientCallable;
exports.createSyncData = Service.createSyncData;
exports.getThisConnected = Service.getThisConnected;
