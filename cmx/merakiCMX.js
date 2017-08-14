
// Cisco Meraki CMX Listener

/*
 This node will accept a JSON post from the Cisco Meraki CMX Presence API.
 It will first respond to a [GET] request and respond with a validator key (provided within the Meraki Dashboard)
 Meraki will then send a [POST] which includes the CMX JSON data, including a user defined secret
 If the secret matches, the data will be set to the msg.payload object.

 Written by: Cory Guynn
 www.Meraki.com
 www.InternetOfLEGO.com
*/

module.exports = function (RED) {
  "use strict";
  var bodyParser = require("body-parser");
  var jsonParser = bodyParser.json();

  function merakiCMXsettings(config) {
    RED.nodes.createNode(this,config);
  }
    
  // Settings
  RED.nodes.registerType("meraki-cmx-settings",merakiCMXsettings,{
    credentials: {
      secret: {type:"text"},
      validator: {type:"text"}
    }
  });

  // output node
  function merakiCMX(config) {

    RED.nodes.createNode(this,config);

    if (!config.url) {
      this.warn(RED._("merakiCMX.errors.missing-path"));
      return;
    }
    this.name = config.name;

    this.url = config.url;
    this.radioType = config.radioType;
    // Retrieve the config node
    this.settings = RED.nodes.getNode(config.settings);

    // copy "this" object in case we need it in context of callbacks of other functions.
    var node = this;

    // Start CMX Listener using config settings
    cmxServer(node);

    // close open URL listeners
    this.on("close",function() {
      RED.log.info(RED._("merakiCMX.server.close-routes") + node.url);
      for (var i = RED.httpNode._router.stack.length - 1; i >= 0; i--) {
        if (RED.httpNode._router.stack[i].route){
          if (RED.httpNode._router.stack[i].route.path === node.url) {
            RED.log.info(RED._("merakiCMX.server.remove-urls") + node.url);
            RED.httpNode._router.stack.splice(i, 1);
          }
        }
      } 
    });

  };
  RED.nodes.registerType("Meraki CMX",merakiCMX);

  // CMX Server
  function cmxServer(node){
    node.status({fill:"yellow",shape:"dot",text:"waiting for first contact"});

    var data = {};
    
    RED.httpNode.get(node.url, function(req, res){
      var remoteAddress = req.headers.hasOwnProperty('x-forwarded-for')? req.headers['x-forwarded-for'] : req.connection.remoteAddress;
      // RED.log.info(RED._("merakiCMX.server.receive-get-request") + remoteAddress);
      node.status({fill:"blue",shape:"dot",text:"sent validator"});
      setTimeout(function(){
        node.status({fill:"green",shape:"dot",text:"listening"});
      }, 5000);
      data.payload = node.settings.credentials.validator;
      var status = {};
      status.topic = "validator";
      status.payload = "sending validator";
      status.validator = node.settings.credentials.validator;
      status.remoteAddress = remoteAddress;
      node.send([null, status]);
      res.send(data.payload);
    });

    RED.httpNode.post(node.url, jsonParser, function(req, res){
      var remoteAddress = req.headers.hasOwnProperty('x-forwarded-for')? req.headers['x-forwarded-for'] : req.connection.remoteAddress;
        // RED.log.info(RED._("merakiCMX.server.receive-post-data") + remoteAddress);

      try{
        if(req.body == null || Object.keys(req.body).length == 0 || typeof req.body !== "object"){
          // RED.log.error(RED._("merakiCMX.errors.invalid-request"));
          throw "unrecognized data";
        }

        if(req.body.version !== "2.0"){
          RED.log.error(RED._("merakiCMX.errors.invalid-api-version") + req.body.version);
          node.status({fill:"red",shape:"dot",text:"invalid API version: "+req.body.version});
          setTimeout(function(){
            node.status({fill:"green",shape:"dot",text:"listening"});
          }, 5000);
          res.sendStatus(500);
          data.payload = node.settings.credentials.validator;
          var status = {};
          status.topic = "version";
          status.payload = "incorrect version";
          status.supportedVersion = "2.0";
          status.version = req.body.version;
          status.remoteAddress = remoteAddress;
          status.statusCode = 500; // server error
          node.send([null, status]);
          res.end();
          return null;
        }       

        // Check Secret
        if (req.body.secret !== node.settings.credentials.secret) {
          // Secret invalid
          RED.log.error(RED._("merakiCMX.errors.invalid-secret") + remoteAddress);
          node.status({fill:"red",shape:"dot",text:"secret invalid"});
          res.sendStatus(401); // unauthorized
          // node.error("Invalid Secret from " + remoteAddress);
          var status = {};
          status.topic = "secret";
          status.payload = "invalid secret";
          status.secret = req.body.secret;
          status.version = req.body.version;
          status.remoteAddress = remoteAddress;
          status.statusCode = 401;
          node.error(status);
          node.send([null, status]);
          res.end();      
          return null
        }else{
          // Secret verified
          RED.log.info(RED._("merakiCMX.server.secret-verified") + remoteAddress);
          node.status({fill:"blue",shape:"dot",text:"data received"});
          setTimeout(function(){
            node.status({fill:"green",shape:"dot",text:"listening"});
          }, 5000);
          //carry to the next step
          // var status = {};     
          // status.topic = "secret";
          // status.payload = "secret verified";
          // status.secret = req.body.secret;
          // status.remoteAddress = remoteAddress;
          // node.send([null, status]);
        }

        // Check Radio Observeration Type
        if(node.radioType === req.body.type || node.radioType.toString() === "All"){
          // Send Observations to Data flow
          var status = {};
          status.topic = "data";
          status.payload = "data received";
          status.supportedType = node.radioType;
          status.type = req.body.type;
          status.remoteAddress = remoteAddress;
          status.statusCode = 200;
          data.payload = req.body;
          res.sendStatus(200);
          node.send([data, null]);      
        }else{
          // discarding data as it does not match the expected radio type
          RED.log.info(RED._("merakiCMX.server.discard-non-matching-radio-type"))
          node.status({fill:"yellow",shape:"dot",text:"discarding radio type"});
          setTimeout(function(){
            node.status({fill:"green",shape:"dot",text:"listening"});
          }, 5000);
          var status = {};
          status.topic = "type";
          status.payload = "discarding radio type";
          status.supportedType = node.radioType;
          status.type = req.body.type;
          status.remoteAddress = remoteAddress;
          status.statusCode = 200; // OK 
          res.sendStatus(200); //respond to client with status code
          node.send([null, status]);
          res.end();
          return null
        }     
         
      } catch (e) {
        // An error has occured
        RED.log.error(RED._("merakiCMX.errors.invalid-request") + remoteAddress + " : " + e);
        node.status({fill:"red",shape:"dot",text:"invalid post"});
        res.sendStatus(500); // Server Error    
        node.error("Invalid POST req data from " + remoteAddress, req);
        var status = {};
        status.topic = "error";
        status.payload = "invalid post data";
        status.remoteAddress = req.connection.remoteAddress;
        status.error = e;
        status.data = req;
        status.statusCode = 500;
        node.send([null, status]); 
        // res.send(req);
        res.end();
         return null
      }
    });
  }
}
