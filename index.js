const { GraphQLClient } = require('graphql-request');
var request = require('request');
var MjpegConsumer = require('mjpeg-consumer');
const cloudinary = require('cloudinary').v2;

const userMail = 'InputUser';
const userName = 'InputUser';
const userPw = 'Ewi_g9fTD}Nr%Xj@';
const backendLocation = 'https://indebrau-backend.herokuapp.com';
const cacheUpdateInterval = 10; // in seconds

const cloudinaryConfig = {
  cloud_name: 'indebrau',
  api_key: '773223492246879',
  api_secret: 'FbsQhRkJsyCwjVjRsctty1lzd_4'
};

var graphQLClient = new GraphQLClient(backendLocation);
var activeMediaStreamsCache = {}; // holds a list of active media streams
var lastCacheUpdateTimeStamp = null; // last update of cache

async function main() {
  // startup process
  console.log('Startup...');
  // login or register input user
  await loginOrRegister();
  // populate the initial active media streams cache
  await updateMediaStreamsCache();
  // pass API key and secret to Cloudinary object
  cloudinary.config(cloudinaryConfig);
  console.log('Started!');
  // finished startup, now register media consumers

  // "brewingProcesses/liveImages/mainView" cam device
  var mainViewConsumer = new MjpegConsumer();
  var lastTimeStampMainView = new Date();
  var mainViewMediaStream;
  request('http://192.168.50.156/')
    .pipe(mainViewConsumer)
    .on('data', function(data) {
      if (new Date() - lastCacheUpdateTimeStamp > cacheUpdateInterval * 1000) {
        // don't wait for this, might result in 1-2 seconds delayed update (and multiple updates),
        // which is ok (in comparison to pausing the media processing)
        updateMediaStreamsCache();
      }
      mainViewMediaStream = null; // first set to null...
      for (var i = 0; i < activeMediaStreamsCache.length; i++) {
        if (
          activeMediaStreamsCache[i].name ===
          'brewingProcesses/liveImages/mainView'
        ) {
          // found it
          mainViewMediaStream = activeMediaStreamsCache[i];
          break;
        }
      }
      if (!mainViewMediaStream) return; // not in active streams list
      if (
        new Date() - lastTimeStampMainView >
        mainViewMediaStream.updateFrequency * 1000
      ) {
        // temporary cache the "old" last time stamp in case of failure with upload
        let oldLastTimeStampMainView = lastTimeStampMainView;
        lastTimeStampMainView = new Date();

        cloudinary.uploader
          .upload_stream({ upload_preset: 'liveImagesMainView' }, function(
            responseMessage
          ) {
            // responseMessage is undefined if upload is successfull
            if (responseMessage) {
              console.log('Error Uploading:' + responseMessage);
              // "reset" timestamp
              lastTimeStampMainView = oldLastTimeStampMainView;
            } else {
              // success
              console.log(
                'Uploaded media file to Cloudinary with preset liveImagesMainView at: ' +
                  lastTimeStampMainView
              );
            }
          })
          .end(data);
      }
    });

  // "brewingProcesses/liveImages/secondaryView" cam device
  var secondaryViewConsumer = new MjpegConsumer();
  var lastTimeStampSecondaryView = new Date();
  var secondaryViewMediaStream;
  request('http://192.168.50.157/')
    .pipe(secondaryViewConsumer)
    .on('data', function(data) {
      if (new Date() - lastCacheUpdateTimeStamp > cacheUpdateInterval * 1000) {
        // don't wait for this, might result in 1-2 seconds delayed update (and multiple updates),
        // which is ok (in comparison to pausing the media processing)
        updateMediaStreamsCache();
      }
      secondaryViewMediaStream = null; // first set to null...
      for (var i = 0; i < activeMediaStreamsCache.length; i++) {
        if (
          activeMediaStreamsCache[i].name ===
          'brewingProcesses/liveImages/secondaryView'
        ) {
          // found it
          secondaryViewMediaStream = activeMediaStreamsCache[i];
          break;
        }
      }
      if (!secondaryViewMediaStream) return; // not in active streams list
      if (
        new Date() - lastTimeStampSecondaryView >
        secondaryViewMediaStream.updateFrequency * 1000
      ) {
        // temporary cache the "old" last time stamp in case of failure with upload
        let oldLastTimeStampSecondaryView = lastTimeStampSecondaryView;
        lastTimeStampSecondaryView = new Date();

        cloudinary.uploader
          .upload_stream({ upload_preset: 'liveImagesSecondaryView' }, function(
            responseMessage
          ) {
            // responseMessage is undefined if upload is successfull
            if (responseMessage) {
              console.log('Error Uploading:' + responseMessage);
              // "reset" timestamp
              lastTimeStampSecondaryView = oldLastTimeStampSecondaryView;
            } else {
              // success
              console.log(
                'Uploaded media file to Cloudinary with preset liveImagesSecondaryView at: ' +
                  lastTimeStampSecondaryView
              );
            }
          })
          .end(data);
      }
    });
}

main();

async function loginOrRegister() {
  console.log('Login user...');
  let mutation = /* GraphQL */ `
    mutation signin($email: String!, $password: String!) {
      signin(email: $email, password: $password) {
        token
      }
    }
  `;
  let variables = {
    email: userMail,
    password: userPw
  };
  try {
    let data = await graphQLClient.request(mutation, variables);
    graphQLClient = new GraphQLClient(backendLocation, {
      headers: {
        Authorization: 'Bearer ' + data.signin.token
      }
    });
    console.log('Logged in!');
  } catch (e) {
    console.log('Login not possible, trying to register new user...');

    mutation = /* GraphQL */ `
      mutation signup($name: String!, $password: String!, $email: String!) {
        signup(name: $name, password: $password, email: $email) {
          token
        }
      }
    `;
    variables = {
      name: userName,
      password: userPw,
      email: userMail
    };
    try {
      let data = await graphQLClient.request(mutation, variables);
      graphQLClient = new GraphQLClient(backendLocation, {
        headers: {
          Authorization: 'Bearer ' + data.signup.token
        }
      });
      console.log('Registered new user!');
    } catch (e) {
      // No login and signup possible...
      console.log(e);
      process.exit(1);
    }
  }
}

async function updateMediaStreamsCache() {
  // temporary cache the "old" last time stamp in case of failure with updating
  let oldLastCacheUpdateTimeStamp = lastCacheUpdateTimeStamp;
  lastCacheUpdateTimeStamp = new Date();
  let query = /* GraphQL */ `
    {
      mediaStreams(active: true) {
        id
        name
        updateFrequency
        brewingProcess {
          id
        }
      }
    }
  `;
  try {
    let data = await graphQLClient.request(query);

    // a bit of data flattening
    for (let i = 0; i < data.mediaStreams.length; i++) {
      data.mediaStreams[i].brewingProcess =
        data.mediaStreams[i].brewingProcess.id;
    }
    activeMediaStreamsCache = data.mediaStreams;
    console.log('Updated cache at: ' + lastCacheUpdateTimeStamp);
  } catch (e) {
    // "reset" timestamp
    lastCacheUpdateTimeStamp = oldLastCacheUpdateTimeStamp;
    console.log('Error, cache not updated: ' + e);
  }
}
