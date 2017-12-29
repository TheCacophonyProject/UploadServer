var models = require('../../models');
var util = require('./util');
var jwt = require('jsonwebtoken');
var config = require('../../config/config');
var passport = require('passport');
var responseUtil = require('./responseUtil');
require('../../passportConfig')(passport);
const middleware = require('../middleware');

module.exports = function(app, baseUrl) {
  var apiUrl = baseUrl + '/users';


  /**
   * @api {post} /api/v1/users Register a new user
   * @apiName RegisterUser
   * @apiGroup User
   *
   * @apiParam {String} username Username for new user.
   * @apiParam {String} password Password for new user.
   *
   * @apiUse V1ResponseSuccess
   * @apiSuccess {String} token JWT for authentication. Contains the user ID and type.
   * @apiSuccess {JSON} userData Metadata of the user.
   *
   * @apiUse V1ResponseError
   */
  app.post(
    apiUrl,
    middleware.logging,
    middleware.parseParams({
      body: {
        username: { type: 'STRING' },
        password: { type: 'STRING' },
      },
    }),
    middleware.asyncWrapper(async (request, response) => {

      console.log(request.parsed);
      // TODO check that username is not already used.
      const user = await models.User.create({
        username: request.parsed.body.username,
        password: request.parsed.body.password,
      });

      const data = user.getJwtDataValues();

      responseUtil.send(response, {
        statusCode: 200,
        success: true,
        messages: ['Created a new user'],
        token: 'JWT ' + jwt.sign(data, config.server.passportSecret),
      });



      /*
        .then(function(user) { // Created new User
          var data = user.getJwtDataValues();
          user.getDataValues()
            .then(function(userData) {
              responseUtil.send(response, {
                statusCode: 200,
                success: true,
                messages: ['Created new user.'],
                token: 'JWT ' + jwt.sign(data, config.server.passportSecret),
                userData: userData
              });
            });
        })
        .catch(function(err) { // Error with creating user.
          responseUtil.serverError(request, err);
        });
        */
    })
  );

  /**
   * @api {get} api/v1/users Get users
   * @apiName GetUsers
   * @apiGroup User
   *
   * @apiUse V1UserAuthorizationHeader
   *
   * @apiParam {JSON} where [Sequelize where conditions](http://docs.sequelizejs.com/manual/tutorial/querying.html#where) for query.
   *
   * @apiSuccess {JSON} usersData List of users.
   * @apiUse V1ResponseSuccess
   *
   * @apiUse V1ResponseError
   */
  app.get(
    apiUrl,
    async function(request, response) {

      var where = request.query.where;
      try {
        where = JSON.parse(where);
      } catch(e) {
        return responseUtil.send(response, {
          statusode: 400,
          success: false,
          messages: ['Failed to parse "where" as a JSON.'],
        });
      }
      var users = await models.User.getAll(where);
      return responseUtil.send(response, {
        statusCode: 200,
        success: true,
        messages: [],
        users: users,
      });
    });
};
