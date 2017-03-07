var responseUtil = require('./responseUtil');
var util = require('./util');
var models = require('../../models');
var formidable = require('formidable');

var NO_HEADERS_FOUND =
  'No headers found in request.';
var INVALID_HEADER_OFFSET =
  '"offset" header field was not a valid integer';
var INVALID_HEADER_LIMIT =
  '"limut" header field was not a valid integer';
var INVALID_HEADER_WHERE =
  '"where" header field was not a valid integer';
var INVALID_FORM_POST_DATA =
  '"data" field in form was not found or a valid JSON.';
var INVALDI_FORM_POST_FILE =
  '"file" field was not found or valid file.';

function getSequelizeQueryFromHeaders(request) {
  if (typeof request.headers !== 'object')
    return { badRequest: NO_HEADERS_FOUND };

  var offset = parseInt(request.headers.offset || 0);
  if (typeof offset !== 'number')
    return { badRequest: INVALID_HEADER_OFFSET };

  var limit = parseInt(request.headers.limit || 20);
  if (typeof limit !== 'number')
    return { badRequest: INVALID_HEADER_LIMIT };

  var where = util.parseJsonFromString(request.headers.where || '{}');
  if (typeof where !== 'object')
    return { badRequest: INVALID_HEADER_WHERE };

  return {
    where: where,
    limit: limit,
    offset: offset,
  };
}

// Checks that the request was validated from a User JWT.
function isFromAUser(request) {
  return request && // Check that request isn't null.
    request.user && // Check that request.user isn't null.
    request.user.Model === models.User; // Check that it is is a User model.
}

// Checks that the request was validated from a Device JWT.
function isFromADevice(request) {
  return request && // Check that request isn't null.
    request.user && // Check that request.user isn't null.
    request.user.Model === models.Device; // Check that it is is a Device model.
}

function getFileAndDataField(request) {
  return new Promise(function(resolve, reject) {
    var form = new formidable.IncomingForm();
    form.parse(request, function(error, fields, files) {

      if (error) return reject(error);

      var data = util.parseJsonFromString(fields.data);
      if (data === null || typeof data !== 'object')
        return reject({ badRequest: INVALID_FORM_POST_DATA });

      // TODO do more checks that it is a valid file.
      var file = files.file;
      if (file === null || typeof file !== 'object')
        return reject({ badRequest: INVALDI_FORM_POST_FILE });

      return resolve([data, file]);
    });
  });
}

exports.getSequelizeQueryFromHeaders = getSequelizeQueryFromHeaders;
exports.isFromAUser = isFromAUser;
exports.isFromADevice = isFromADevice;
exports.getFileAndDataField = getFileAndDataField;
