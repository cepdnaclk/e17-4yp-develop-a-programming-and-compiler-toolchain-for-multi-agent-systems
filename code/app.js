const express = require("express");
const fs = require("fs");
var bodyParser = require("body-parser");
// const { exec } = require("child_process");

const app = express();
const httpServer = require("http").createServer(app);
var cors = require("cors");

var currentAlgorithmName = "MyTestRobot";

const socketIO = require("socket.io")(httpServer, {
  cors: {
    origin: "*",
  },
  origins: "localhost:*",
});

const generateFeatureFile = (dir, features) => {
  var fileString = "";
  var header = `
    #pragma once
    /*
      This is an auto-generated file.
    */\n\n`;
  fileString = fileString.concat(header);
  console.log(features);
  features.forEach((f) => {
    if (f.isEnabled) {
      const featureDefine = `#define ${f.value.toUpperCase()}${
        f.extra ? f.extra.join(" ") : ""
      }\n\n`;
      fileString = fileString.concat(featureDefine);
      if (f.dependencies && f.dependencies?.length > 0) {
        let depDefine = `#ifdef ${f.value}\n`;
        f.dependencies.forEach((dep) => {
          if (dep.isEnabled) {
            depDefine = depDefine.concat(
              `#define ${dep.value.toUpperCase()}\n`
            );
          }
        });
        depDefine = depDefine.concat(`#endif\n\n`);
        fileString = fileString.concat(depDefine);
      }
    }
  });
  fileString = fileString.concat("/* ------- End of file ------- */");
  console.log(fileString);
  fs.writeFileSync(`${dir}/features.h`, fileString);
};

const generateAlgorithmFile = (dir, algorithm_name, fileString) => {
  try {
    fs.writeFileSync(`${dir}/${algorithm_name}.cpp`, fileString);
  } catch (error) {}
};
const generateVirtualRobotAlgorithmFile = (dir, algorithm_name, fileString) => {
  console.log(algorithm_name);
  console.log(dir);
  try {
    fs.writeFileSync(`${dir}/${algorithm_name}.java`, fileString);
  } catch (error) {}
};

const generateCustomInitFileForRobot = (dir, robotId) => {
  let fileString = `
;PlatformIO Project Configuration File
[platformio]
src_dir = firmware

[env:nodemcu-32s]
platform = espressif32
board = nodemcu-32s
framework = arduino

; Serial Monitor options
monitor_speed = 115200

extra_script=pre:extra_script.py
build_flags =
    '-DROBID=${robotId}'
rob_id = ${robotId}
`;
  try {
    fs.writeFileSync(`${dir}/platformio.ini`, fileString);
  } catch (error) {}
};

const generateMainAppForVirtualRobot = (dir, algorithm_name, robotArr) => {
  console.log(robotArr);

  // Start building the dynamic portion of the code based on robotArr
  let dynamicCode = "";

  for (let i = 0; i < robotArr.length; i++) {
    const { vRobotId, xCoordinate, yCoordinate, heading } = robotArr[i];

    // Build code for creating MyTestRobot objects
    dynamicCode += `
    Robot robot${vRobotId} = new ${algorithm_name}(${vRobotId}, ${xCoordinate}, ${yCoordinate}, ${heading});
    new Thread(robot${vRobotId}).start();
    `;
  }

  let fileString = `
  package swarm;

  import swarm.configs.MQTTSettings;
  import swarm.robot.Robot;
  
  import java.io.File;
  import java.io.FileNotFoundException;
  import java.io.FileReader;
  import java.io.IOException;
  import java.util.Properties;
  
  import Robots.*;
  import swarm.robot.VirtualRobot;
  import swarm.robot.exception.SensorException;
  import swarm.robot.sensors.ColorSensor;
  
  public class App extends Thread {
  
      public static void main(String[] args) {
  
          try {
              // COMPLETE THIS BEFORE RUN
              // Read config properties from the file, src/resources/config/mqtt.properties
              // If it isn't there, please make one, as given sample in the
              // 'mqtt.properties' file
  
              File configFile = new File("src/resources/config/mqtt.properties");
              FileReader reader = new FileReader(configFile);
              Properties props = new Properties();
              props.load(reader);
  
              MQTTSettings.server = props.getProperty("server");
              MQTTSettings.port = Integer.parseInt(props.getProperty("port", "1883"));
              MQTTSettings.userName = props.getProperty("username");
              MQTTSettings.password = props.getProperty("password");
              MQTTSettings.channel = props.getProperty("channel", "v1");
              reader.close();
              
              // Start dynamic code section
              ${dynamicCode}
              // End dynamic code section
  
          } catch (FileNotFoundException ex) {
              // file does not exist
              System.out.println("Config file, 'resources/config/mqtt.properties' Not Found !!!");
  
          } catch (IOException ex) {
              // I/O error
              System.out.println("IO Error !!!");
          }
      }
  }
  
`;
  try {
    fs.writeFileSync(`${dir}/src/main/java/swarm/App.java`, fileString);
  } catch (error) {}
};

const childProcess = require("child_process");

const port = 5001;

socketIO.on("connection", (socket) => {
  console.log("Connection established!");
});

app.use(cors());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.get("/", (_, res) => {
  return res.json({ msg: "Hello from remote cross compiler..." });
});

app.get("/update", (req, res) => {
  console.log(req.query);
  const file = `${__dirname}/${
    req.query.dir || "esp_robot_firmware"
  }/recent_builds/firmware_${req.query.robot_id}.bin`;
  res.download(file);
});

app.post("/physicalrobot/build", async (req, res) => {
  const firmwareDir = req.query.dir || "esp_robot_firmware";
  console.log(req.body);

  res.json({ msg: `${firmwareDir} build started!` });
  // validate schema! //TODO : Important
  socketIO.emit("Feature file validation...SKIPPING.....\n");

  // generate feature file..
  socketIO.emit("Generating feature file...\n");
  generateFeatureFile(`${firmwareDir}/firmware`, req.body?.features || []);
  socketIO.emit("Feature file generated successfully...\n\n");

  // generate algorithm
  const algorithm_name = req.body?.algorithm_name;
  socketIO.emit(`Writing algorithm to file ${algorithm_name}...\n`);
  generateAlgorithmFile(
    `${firmwareDir}/firmware/algorithms`,
    algorithm_name,
    req.body?.algorithm_body
  );
  socketIO.emit("File written successfully...\n\n");
  const robot_id = req.body?.robot_id ?? 0;
  socketIO.emit("build", `Building for robot ${robot_id}\n`);
  generateCustomInitFileForRobot(firmwareDir, robot_id);
  const bash_run = childProcess.spawn(
    `cd ${
      req.query.dir || "esp_robot_firmware"
    } && pio run && cp ./.pio/build/nodemcu-32s/firmware_${robot_id}.bin ./recent_builds`,
    { shell: true }
  );
  bash_run.stdout.on("data", function (data) {
    socketIO.emit("build", data.toString());
  });
  bash_run.stderr.on("data", function (data) {
    socketIO.emit("build", data.toString());
  });
});

//build virtual robot code
app.post("/build", async (req, res) => {
  //const virtualRobotDir = req.query.virtualDir || "java_virtual_robot/java-robot-library";
  const virtualRobotDir = "java_virtual_robot/robot-library-java";

  res.json({ msg: `${virtualRobotDir} build started!` });

  // Execute Maven build command
  const bash_run = childProcess.spawn(
    `cd ${virtualRobotDir} && mvn -f pom.xml clean install`,
    { shell: true }
  );

  bash_run.stdout.on("data", function (data) {
    socketIO.emit("build", data.toString());
  });

  bash_run.stderr.on("data", function (data) {
    socketIO.emit("build", data.toString());
  });
});

//build virtual robot code
app.post("/virtualrobot/build", async (req, res) => {
  //const virtualRobotDir = req.query.virtualDir || "java_virtual_robot/java-robot-library";
  const virtualRobotDir = "java_virtual_robot/robot-library-java";

  res.json({ msg: `${virtualRobotDir} build started!` });

  // generate algorithm
  const algorithm_name = req.body?.algorithm_name;

  currentAlgorithmName = algorithm_name;

  // const isInbuiltAlgorithm = req.body?.isInbuiltAlgorithm;
  // if (!isInbuiltAlgorithm) {
  socketIO.emit(`Writing algorithm to file ${algorithm_name}...\n`);
  //console.log(algorithm_name);
  generateVirtualRobotAlgorithmFile(
    `${virtualRobotDir}/src/main/java/Robots`,
    algorithm_name,
    req.body?.algorithm_body
  );
  socketIO.emit("File written successfully...\n\n");

  generateMainAppForVirtualRobot(
    virtualRobotDir,
    algorithm_name,
    req.body?.robot_array
  );

  const mavenCommand = `cd ${virtualRobotDir} && mvn -f pom.xml clean install && cp ./target/java-robot-1.0.2.jar ./recent_builds`;

  // Execute Maven build command
  const bash_run = childProcess.spawn(mavenCommand, { shell: true });

  // Execute Maven build command
  //const bash_run = childProcess.spawn(`cd ${virtualRobotDir} && mvn clean install`, { shell: true });

  bash_run.stdout.on("data", function (data) {
    socketIO.emit("build", data.toString());
  });

  bash_run.stderr.on("data", function (data) {
    socketIO.emit("build", data.toString());
  });

  // Listen for the exit event
  bash_run.on("exit", function (code) {
    if (code === 0) {
      // The command was successful
      socketIO.emit("success", "Maven build succeeded!");
    } else {
      // The command failed
      socketIO.emit("error", "Maven build failed!");
    }
  });
});

app.get("/updateAppJava", (req, res) => {
  console.log(req.query);
  // const file = `java_virtual_robot/robot-library-java/recent_builds/java-robot-1.0.2.jar`;
  const file = `java_virtual_robot/robot-library-java/src/main/java/swarm/App.java`;

  res.download(file);
});

const path = require("path");

const rootDirectory = __dirname;
app.use(express.static(__dirname));

app.get("/updateAlgorithm", (req, res) => {
  console.log(req.query);
  // Define the file path
  const filePath = `java_virtual_robot/robot-library-java/src/main/java/Robots/${currentAlgorithmName}.java`;
  console.log(filePath, currentAlgorithmName);

  // Set the response headers to specify the file name
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${currentAlgorithmName}.java"`
  );

  // Send the file as a response
  res.sendFile(filePath, { root: rootDirectory });
});

httpServer.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
