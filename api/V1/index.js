var fs = require('fs');
var path = require('path');

module.exports = function(app) {
  var apiRouts = fs.readdirSync(__dirname);

  // Remove files that are not added to app directly
  apiRouts.splice(apiRouts.indexOf('index.js'), 1);
  apiRouts.splice(apiRouts.indexOf('util.js'), 1);
  apiRouts.splice(apiRouts.indexOf('requestUtil.js'), 1);
  apiRouts.splice(apiRouts.indexOf('responseUtil.js'), 1);
  apiRouts.splice(apiRouts.indexOf('tagsUtil.js'), 1);
  apiRouts.splice(apiRouts.indexOf('apidoc.js'), 1);

  for (var i in apiRouts)
    require(path.join(__dirname, apiRouts[i]))(app, '/api/v1');

  /**
   * Basic error handler.
   */
  app.use((err, request, response, next) => {
    if (isNaN(err.statusCode)) {
      return response.status(500).send('server error');
    }
    response.status(err.statusCode).send(err.message);
  });
};
