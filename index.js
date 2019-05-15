const { GraphQLClient } = require('graphql-request');
var request = require('request');
var MjpegConsumer = require('mjpeg-consumer');
const cloudinary = require('cloudinary').v2;

const userMail = 'InputUser';
const userName = 'InputUser';
const userPw = 'Ewi_g9fTD}Nr%Xj@';
const backendLocation = 'https://indebrau-backend.herokuapp.com';
cloudinary.config({
  cloud_name: 'indebrau',
  api_key: '773223492246879',
  api_secret: 'FbsQhRkJsyCwjVjRsctty1lzd_4',
  upload_preset: 'liveImagesMainView'
});

var graphQLClient = new GraphQLClient(backendLocation);

async function main() {
  console.log('startup...');
  var consumer = new MjpegConsumer();
  var lastTimeStamp = new Date();

  console.log('Register or login user...');
  let data;
  let token;
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
    data = await graphQLClient.request(mutation, variables);
    token = data.signin.token;
    console.log('Received token: ' + token);
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
      data = await graphQLClient.request(mutation, variables);
      token = data.signup.token;
      console.log('Received token: ' + token);
    } catch (e) {
      // No login and signup possible...
      console.log(e);
      process.exit(1);
    }
  }

  // update client variable
  graphQLClient = new GraphQLClient(backendLocation, {
    headers: {
      Authorization: 'Bearer ' + token
    }
  });
  console.log('Starting...');

  // TODO: Get list of active media streams (and maintain!)

  request('http://192.168.178.33/')
    .pipe(consumer)
    .on('data', function(data) {
      let currentTimeStamp = new Date();
      if (currentTimeStamp - lastTimeStamp > 3000) {
        lastTimeStamp = new Date();
        cloudinary.uploader
          .upload_stream(function(responseMessage) {
            // responseMessage is undefined if upload is successfull
            if (responseMessage) {
              console.log(responseMessage);
            } else {
              console.log('uploaded');
            }
          })
          .end(data);
      }
    });
}

main();
