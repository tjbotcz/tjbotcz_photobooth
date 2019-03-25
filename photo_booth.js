//TJBot libs
var TJBot = require("tjbot");
var conf = require("./config"); //tjConfig & local czech enhancements
var confCred = require("./credentials"); //credentials only
var fs = require("fs"); //filesystem
var ipp = require('ipp')//printig module

//Pigpio library for LED (simple version)
var gpio = require("pigpio").Gpio;
const _basic_colors = ["red", "green", "blue", "yellow", "magenta", "cyan", "white"];

var pinR = new gpio(conf.ledpins.R, { mode: gpio.OUTPUT });
var pinG = new gpio(conf.ledpins.G, { mode: gpio.OUTPUT });
var pinB = new gpio(conf.ledpins.B, { mode: gpio.OUTPUT });
var _RGBLed = { pinR, pinG, pinB };

//REST API
var express = require('express');
var bodyParser = require('body-parser');

//TJBot - Watson services
//---------------------------------------------------------------------
var credentials = confCred.credentials;
var hardware = ['microphone', 'speaker', 'servo', 'camera']; //simple 'rgb_led' as part of this file
var tjConfig = conf.tjConfig;
var _paths = conf.paths;
const PATH = require('path');

var tj = new TJBot(hardware, tjConfig, credentials);

//NODEMAILER
var mailer = require('nodemailer');


//REST API & chat client
//---------------------------------------------------------------------
function initRestAPI() {
  var restAPI = express();
  restAPI.use(bodyParser.urlencoded({ extended: true }));
  restAPI.use(bodyParser.json());

  var port = 80;
  var router = express.Router();

  router.get('/', function (req, res) {
    res.json({ message: 'Hello, this is TJBot\'s REST API!' });
  });

  router.route('/converse')
    .get(function (req, res) {
      res.json({ "error": 'Use [POST] instead!' });
    })
    .post(function (req, res) {
      if (req.body.message) {
        console.log("[REST API] message: " + req.body.message);

        processConversation(req.body.message, function (response) {
          res.json({ message: response.description });

          //read response text from the service
           if (response.description) {
             var newResponse = response.description;
             if(response.description.includes("robot.name")){
               var b = newResponse.slice(-13, -1);
               var n = newResponse.indexOf("robot.name");
               if (n == 0) {
                 var end = newResponse.slice(10, -1);
                 newResponse = tj.configuration.robot.name + " " + end;
                 converse(newResponse, response);
               } else if (b.includes("robot.name")) {
                 var beginning = newResponse.slice(0, n);
                 newResponse = beginning + " " + tj.configuration.robot.name
                 converse(newResponse, response);
               } else {
                 var beginning = newResponse.slice(0, n);
                 var end = newResponse.slice((n+10), -1);
                 newResponse = beginning + " " + tj.configuration.robot.name + " " + end;
                 converse(newResponse, response);
               }
             } else {
               converse(newResponse, response);
            }
           }
        });
      } else {
        var err = "[REST API] 'message' block is missing in the POST payload";
        console.error(err);
        res.json({ "error": err });
      }
    });
    router.get('/getAlbum', function (req, res) {
      readFiles(_paths.picture.orig_dir, (album) => {
        console.log(album);
        res.json(album);
      });
    });
    router.post('/getAlbum', function(req, res) {
      console.log("This is the filename: " + req.body.fileName);
      console.log("This is the filePath: " + _paths.picture.orig_dir + "/" + req.body.fileName);
      sendEmailWithAttachment(req.body.fileName, req.body.receiver, _paths.picture.orig_dir + "/" + req.body.fileName)
    });
    router.post('/deletePicture', function(req, res) {
      console.log(req.body);
      deletePicture(req.body.fileName);
    });

    router.post('/printPicture', function(req, res) {
      console.log(req.body);
      printPicture(req.body.fileName);
    });

  restAPI.use('/rest', router);
  restAPI.use(express.static(__dirname + '/public'));

  restAPI.listen(port);
  console.log('RestAPI is active on port ' + port);
}

//---------------------------------------------------------------------
// Functions
//---------------------------------------------------------------------

//VISUAL RECOGNITION
//---------------------------------------------------------------------

/**
 * TAKE A FOTO
 */
function take_a_photo() {
led_change_color("green");
  return new Promise(function (resolve, reject) {
    var timeStamp = new Date().getTime();
    var picture_path = _paths.picture.orig_dir + 'img_' + timeStamp;
    tj.takePhoto(picture_path).then(function (data) {
      if (!fs.existsSync(picture_path + '.jpg')) {
        reject("expected img.jpg to have been created");
      } else {
          resolve("picture taken successfully");
      }
    });
     tj.play(_paths.music.take_a_picture);

  });
}


/**
 * LISTEN
 */
function listen() {
  tj.speak("Hello, my name is " + tj.configuration.robot.name + "  .... Today I will create remarkable memories for you. Its easy. Just get ready for the picture,  look at my little eye and smile! Are you ready?!");

  tj.listen(function (msg) {
    // check to see if they are talking to TJBot
    if (msg.indexOf(tj.configuration.robot.name) > -1) { //robot's name is in the text
      // remove our name from the message
      var msgNoName = msg.toLowerCase().replace(tj.configuration.robot.name.toLowerCase(), "");

      processConversation(msgNoName, function (response) {
        //read response text from the service
        if (response.description) {
          var newResponse = response.description;
          if(response.description.includes("robot.name")){
            var b = newResponse.slice(-13, -1);
            var n = newResponse.indexOf("robot.name");
            if (n == 0) {
              var end = newResponse.slice(10, -1);
              newResponse = tj.configuration.robot.name + " " + end;
              converse(newResponse, response);
            } else if (b.includes("robot.name")) {
              var beginning = newResponse.slice(0, n);
              newResponse = beginning + " " + tj.configuration.robot.name
              converse(newResponse, response);
            } else {
              var beginning = newResponse.slice(0, n);
              var end = newResponse.slice((n+10), -1);
              newResponse = beginning + " " + tj.configuration.robot.name + " " + end;
              converse(newResponse, response);
            }
          } else {
            converse(newResponse, response);
          }
        }
      });
    }
  });
}

function converse(text, response) {
  tj.speak(text).then(function () {
    if (response.object.context.hasOwnProperty('action')) {
      var cmdType = response.object.context.action.cmdType;
      var cmdPayload;
      if (response.object.context.action.hasOwnProperty('cmdPayload')) {
        cmdPayload = response.object.context.action.cmdPayload;
      }
      processAction(cmdType, cmdPayload);
    }
  });
}

/**
 * PROCESS CONVERSATION
 * @param inTextMessage - text
 */
function processConversation(inTextMessage, callback) {
  // send to the conversation service
  tj.converse(confCred.conversationWorkspaceId, inTextMessage, function (response) {
    console.log(JSON.stringify(response, null, 2));
    callback(response);
  });

}


//PROCESS ACTIONS
//---------------------------------------------------------------------
function processAction(cmd, payload) {
  switch (cmd) {
    case "tjbot_reset":
      resetTJBot();
      break;
    case "take_a_photo":
      take_a_photo().then(function () {
        setTimeout(() => {
          tj.speak("Yeyy! What a nice picture! Check it out! Do you want me to take another one?");
          led_change_color("red");
        }, 5000)
      });
      break;
      case "led_turn_on":
        led_turn_on_all();
        break;
      case "led_turn_off":
        led_turn_off_all();
        break;
      case "led_change_color":
        led_change_color(payload.color);
        break;
      case "wave_arm":
        wave_arm(payload.position);
        break;
      case "take_1000":
        takeThousandPictures();
        break;
      default:
        console.log("Command not supported... " + cmd);
    }
  }

  //helper
  function led_turn_on(led) {
    led.digitalWrite(1);
  }
  //helper
  function led_turn_off(led) {
    led.digitalWrite(0);
  }
  /**
   * helper which can change the color of the RGB led.
   *
   * @param {String} color The color to use. Must be from list of _basic_colors.
  */
  function changeColorRGBLed(color, callback) {
    switch (color) {
      case "red":
        led_turn_on(_RGBLed.pinR);
        led_turn_off(_RGBLed.pinG);
        led_turn_off(_RGBLed.pinB);
        break;
      case "green":
        led_turn_off(_RGBLed.pinR);
        led_turn_on(_RGBLed.pinG);
        led_turn_off(_RGBLed.pinB);
        break;
      case "blue":
        led_turn_off(_RGBLed.pinR);
        led_turn_off(_RGBLed.pinG);
        led_turn_on(_RGBLed.pinB);
        break;
      case "yellow":
        led_turn_on(_RGBLed.pinR);
        led_turn_on(_RGBLed.pinG);
        led_turn_off(_RGBLed.pinB);
        break;
      case "magenta":
        led_turn_on(_RGBLed.pinR);
        led_turn_off(_RGBLed.pinG);
        led_turn_on(_RGBLed.pinB);
        break;
      case "cyan":
        led_turn_off(_RGBLed.pinR);
        led_turn_on(_RGBLed.pinG);
        led_turn_on(_RGBLed.pinB);
        break;
      case "white":
        led_turn_on(_RGBLed.pinR);
        led_turn_on(_RGBLed.pinG);
        led_turn_on(_RGBLed.pinB);
        break;
      case "random":
        var randIdx = Math.floor(Math.random() * _basic_colors.length);
        color = _basic_colors[randIdx];
        changeColorRGBLed(color, function (color) { });
        break;
      default:
        console.log("Unknown color.");
        callback(null);
    }
    callback(color);
  }

  //Turns off all the RGB LED colors
  //---------------------------------------------------------------------
  function led_turn_off_all() {
    led_turn_off(_RGBLed.pinR);
    led_turn_off(_RGBLed.pinG);
    led_turn_off(_RGBLed.pinB);
  }

  //Turns on all the RGB LED on random color
  //---------------------------------------------------------------------
  function led_turn_on_all() {
    changeColorRGBLed("random", function (ret_color) {
      if (ret_color) {
        console.log("Color is: " + ret_color);
      } else {
        console.log("Color did not set.");
      }
    });
  }

  //Changes the color of the RGB LED
  //---------------------------------------------------------------------
  function led_change_color(color) {
    changeColorRGBLed(color, function (ret_color) {
      if (ret_color) {
        console.log("Color is: " + ret_color);
      } else {
        console.log("Color did not set.");
      }
    });
  }

  //ARM
  //---------------------------------------------------------------------
  function wave_arm(position) {
    console.log("CMD: " + position);
    switch (position) {
      case "back":
        tj.armBack();
        break;
      case "raised":
        tj.raiseArm();
        break;
      case "forward":
        tj.lowerArm();
        break;
      case "wave":
        tj.wave();
        break;
      default:
        tj.speak("I'm not able to set my arm into this position.");
    }
  }


  //RESET TJBOT
  //---------------------------------------------------------------------
  function resetTJBot() {
    tj.raiseArm();
    led_turn_off_all();
    tj.stopListening();
    initPhotoBooth();
  }

  //PHOTO BOOTH
  function initPhotoBooth(){
    led_change_color("red");
    listen();
  }

//READING PICTURES IN A FOLDER
function readFiles(dirPath, processFile) {
  // read directory
  fs.readdir(dirPath, (err, fileNames) => {
    if (err) throw err;
    var array = [];
    // loop through files
    fileNames.forEach((fileName) => {
      // get current file name
      let name = PATH.parse(fileName).name;
      // get current file extension
      let ext = PATH.parse(fileName).ext;
      // get current file path
      let path = PATH.resolve(dirPath, fileName);
      if (ext == ".jpg"){
        array.push({"name": name,"ext": ext,"path": path})
      };
    });
  // callback, do something with the file
  processFile(array);
  });
}

// SENDING EMAILS WITH ATTACHMENT
function sendEmailWithAttachment(fileName, receiver, img) {
  var transporter = mailer.createTransport({
    host: 'smtp.gmail.com',
        port: 587,
        secure: false, // true for 465, false for other ports
        auth: {
            user: "tjbotcz@gmail.com",
            pass: "tjb@tschool"
        }
  });

  console.log("This is the file I want to send: " + img);


  fs.readFile(img, function (err, data) {
    transporter.sendMail({
        from: 'tjbotcz@gmail.com',
        to: receiver,
        subject: 'Hello from TJBot - Czech Space Week',
        text: 'Hi! This are the pictures you took during Czech Space Week. We would love to see you again, so don\'t forget to follow your facebook group: https://www.facebook.com/groups/tjbotcz',
        attachments: [ {"filename": fileName, "content": fs.createReadStream(img)}]
        },
        function(err, success) {
          if (err) {
            console.log("Something went wrong. Email was not sent!")
            tj.speak("Oh, ouh...something went wrong.")
          }
          else if (success) {
            console.log("Email sent successfully!")
            tj.speak("Yes! The picture is on its way!")
          }
        })
    });
  };

// DELETE PICTURE FROM THE FOLDER
function deletePicture(pictureToDelete) {
  var fileToBeRemoved = _paths.picture.orig_dir + "/" + pictureToDelete;
  fs.unlink(fileToBeRemoved, function(err) {
    if(err && err.code == 'ENOENT') {
        console.log("Picture not found, won't remove it.");
    } else if (err) {
        console.log("Error occurred while trying to delete the picture");
    } else {
        console.log(`Picture deleted`);
        tj.speak("Ugh. I hate being brainwashed.")
    }
  })
}

// PRINT PICTURE
function printPicture(pictureToPrint) {
  var fileToBePrinted = _paths.picture.orig_dir + "/" + pictureToPrint;
  fs.readFile(fileToBePrinted, function(err, data) {
    var printer = ipp.Printer("http://192.168.8.101:631");
    var pictureFile = {
      "operation-attributes-tag": {
        "requesting-user-name": "TJBot CZ",
        "job-name": "Print-Job",
        "document-format": "image/jpeg",
      },
      "job-attributes-tag"{
        "print-scaling":'fit'
      }
      data: data,
    };
    console.log("File read.")
    if (err && err.code == 'ENOENT') {
    } else if (err) z{
      var errorMessage = "Ups, something went wrong while trying print this picture.";
      console.log(errorMessage);
      tj.speak(errorMessage)
    } else {
      printer.execute("Print-Job", pictureFile, function(err, res) {
        if(err){
          console.log(err);
        } else {
          console.log("Image printed.");
          tj.speak("Printiiing!")
        }
      });
    }
  });
}


const button = new gpio(21, {
  mode: gpio.INPUT,
  pullUpDown: gpio.PUD_UP,
  alert: true
});

/*
Level must be stable for 10 ms before an alert event is emitted - to filter out unwanted noise from an input signal
*/
button.glitchFilter(10000);

 /*
 Listening for alert event which will return a callback with two parameters - level wchich van be high or low and tick which is a timestamp of the alert
*/

button.on('alert', function(level, tick) {
  if (level == 0) {
    console.log("Button Pressed")
    take_a_photo().then(function () {
      tj.speak("Yeyy! What a nice picture! Check it out! Do you want me to take another one?");
      led_change_color("red");
    });
  }
});



  //CALL INIT
  //---------------------------------------------------------------------
  resetTJBot();
  initRestAPI();
