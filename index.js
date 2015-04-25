"use strict";

var Service = require('./lib/Service');
var io = null;

exports.setBasePath = function(path) {
  Service.basePath = path;
}

exports.initSocket = function(sockets) {
  io = sockets;
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
