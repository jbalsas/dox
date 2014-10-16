/*!
 * Module dependencies.
 */

var markdown = require('github-flavored-markdown').parse
  , utils = require('./utils')
  , escape = utils.escape
  , parseConstructorBlocks = utils.parseConstructorBlocks
  , getScopeConstructor = utils.getScopeConstructor;

/**
 * Expose api.
 */

exports.api = require('./api');

/**
 * Parse comments in the given string of `js`.
 *
 * @param {String} js
 * @param {Object} options
 * @return {Array}
 * @see exports.parseComment
 * @api public
 */

exports.parseComments = function(js, options){
  options = options || {};
  js = js.replace(/\r\n/gm, '\n');

  var comments = []
    , raw = options.raw
    , comment
    , buf = ''
    , ignore
    , withinMultiline = false
    , withinSingle = false
    , code
    , constructors = parseConstructorBlocks(js);

  for (var i = 0, len = js.length; i < len; ++i) {
    // start comment
    if (!withinMultiline && !withinSingle && '/' == js[i] && '*' == js[i+1]) {
      // code following previous comment
      if (/\S/.test(buf)) {
        comment = comments[comments.length - 1];
        if(comment) {
          comment.code = code = buf.trimRight();
          comment.ctx = exports.parseCodeContext(code, i, constructors);
        }
        buf = '';
      }
      i += 2;
      withinMultiline = true;
      ignore = '!' == js[i];
      buf += js[i];
    // end comment
    } else if (withinMultiline && !withinSingle && '*' == js[i] && '/' == js[i+1]) {
      i += 2;
      buf = buf.replace(/^[ \t]*\* ?/gm, '');
      var comment = exports.parseComment(buf, options);
      comment.ignore = ignore;
      comments.push(comment);
      withinMultiline = ignore = false;
      buf = '';
    } else if (!withinSingle && !withinMultiline && '/' == js[i] && '/' == js[i+1]) {
      withinSingle = true;
      buf += js[i];
    } else if (withinSingle && !withinMultiline && '\n' == js[i]) {
      withinSingle = false;
      buf += js[i];
    // buffer comment or code
    } else {
      buf += js[i];
    }
  }

  if (comments.length === 0) {
    comments.push({
      tags: [],
      description: {full: '', summary: '', body: ''},
      isPrivate: false
    });
  }

  // trailing code
  if (buf.trim().length) {
    comment = comments[comments.length - 1];
    code = buf.trimRight();
    comment.code = code;
    comment.ctx = exports.parseCodeContext(code, i, constructors);
  }

  return comments;
};

/**
 * Parse the given comment `str`.
 *
 * The comment object returned contains the following
 *
 *  - `tags`  array of tag objects
 *  - `description` the first line of the comment
 *  - `body` lines following the description
 *  - `content` both the description and the body
 *  - `isPrivate` true when "@api private" is used
 *
 * @param {String} str
 * @param {Object} options
 * @return {Object}
 * @see exports.parseTag
 * @api public
 */

exports.parseComment = function(str, options) {
  str = str.trim();
  options = options || {};

  // Prepend line break if first line is already a tag
  // instead of description
  if (!str.indexOf('@')) {
    str = '\n' + str;
  }
  
  var comment = { tags: [] }
    , raw = options.raw
    , description = {};

  // parse comment body
  description.full = str.split('\n@')[0];
  description.summary = description.full.split('\n\n')[0];
  description.body = description.full.split('\n\n').slice(1).join('\n\n');
  comment.description = description;

  // parse tags
  if (~str.indexOf('\n@')) {
    var tags = str.split('\n@').slice(1).map(function (tag) {
      return '@' + tag;
    });
    comment.tags = tags.map(exports.parseTag);
    comment.isPrivate = comment.tags.some(function(tag){
      return 'api' == tag.type && 'private' == tag.visibility;
    })
  }

  // markdown
  if (!raw) {
    description.full = markdown(description.full);
    description.summary = markdown(description.summary);
    description.body = markdown(description.body);
  }

  return comment;
}

/**
 * Parse tag string "@param {Array} name description" etc.
 *
 * @param {String}
 * @return {Object}
 * @api public
 */

exports.parseTag = function(str) {
  var tag = {}
    , types = []
    , parts = str.split(/[\s\n]+/)
    , type = tag.type = parts.shift().replace('@', '');

  if (type == 'param' || type == 'return' || type == 'type') {
    var last = parts.shift();
    types.push(last);
    if (types && last && last.indexOf("{") === 0) {
      while (last && last.lastIndexOf('}') !== last.length - 1) {
        last = parts.shift();
        types.push(last);
      }
    }
  }

  switch (type) {
    case 'example':
      tag.string = str.replace(/^\s*@example[\s\n]*/, '');
      break;
    case 'param':
      tag.types = exports.parseTagTypes(types.join(' '));
      tag.name = parts.shift() || '';
      
      // Remove leading hyphen in description
      if (parts.length && parts[0] === '-') {
        parts.shift();
      }
      
      tag.description = parts.join(' ');
      break;
    case 'return':
      tag.types = exports.parseTagTypes(types.join(' '));
      tag.description = parts.join(' ');
      break;
    case 'see':
      if (~str.indexOf('http')) {
        tag.title = parts.length > 1
          ? parts.shift()
          : '';
        tag.url = parts.join(' ');
      } else {
        tag.local = parts.join(' ');
      }
      break;
    case 'api':
      tag.visibility = parts.shift();
      break;
    case 'type':
      tag.types = exports.parseTagTypes(types.join(' '));
      break;
    case 'memberOf':
      tag.parent = parts.shift();
      break;
    case 'augments':
      tag.otherClass = parts.shift();
      break;
    case 'borrows':
      tag.otherMemberName = parts.join(' ').split(' as ')[0];
      tag.thisMemberName = parts.join(' ').split(' as ')[1];
      break;
    case 'throws':
      tag.types = exports.parseTagTypes(parts.shift());
      tag.description = parts.join(' ');
      break;
    default:
      tag.string = parts.join(' ');
      break;
  }

  return tag;
}

/**
 * Parse tag type string "{Array|Object}" etc.
 *
 * @param {String} str
 * @return {Array}
 * @api public
 */

exports.parseTagTypes = function(str) {
  return str
    .replace(/^{/, '')
    .replace(/}$/, '')
    .split(/ *[|,\/] */);
};

var FUNC_STATEMENT_REGEXP       = /^function ([\w$]+) *\(/,
    FUNC_EXPRESSION_REGEXP      = /^var *([\w$]+)[ \t]*=[ \t]*function/,
    PROTOTYPE_METHOD_REGEXP     = /^([\w$]+)\.prototype\.([\w$]+)[ \t]*=[ \t]*function/,
    PROTOTYPE_PROPERTY_REGEXP   = /^([\w$]+)\.prototype\.([\w$]+)[ \t]*=[ \t]*([^\n;]+)/,
    METHOD_REGEXP               = /^([\w$.]+)\.([\w$]+)[ \t]*=[ \t]*function/,
    SCOPED_METHOD_REGEXP        = /^([\w$]+)[ \t]*:[ \t]*function/,
    PROPERTY_REGEXP             = /^([\w$]+)\.([\w$]+)[ \t]*=[ \t]*([^\n;]+)/,
    SCOPED_PROPERTY_REGEXP      = /^([\w$]+)[ \t]*:[ \t]*([^\n;]+)/,
    DECLARATION_REGEXP          = /^var +([\w$]+)[ \t]*(?:=[ \t]*([^\n;]+))?/;
    
var DECLARATION_CODE_TYPE   = 'declaration',
    FUNC_CODE_TYPE          = 'function',
    METHOD_CODE_TYPE        = 'method',
    PROPERTY_CODE_TYPE      = 'property';

/**
 * Parse the context from the given `str` of js.
 *
 * This method attempts to discover the context
 * for the comment based on it's code. Currently
 * supports:
 *
 *   - function statements
 *   - function expressions
 *   - prototype methods
 *   - prototype properties
 *   - methods
 *   - scoped methods
 *   - properties
 *   - scoped properties
 *   - declarations
 *
 * @param {String} str
 * @return {Object}
 * @api public
 */
exports.parseCodeContext = function(str, position, constructors){
    var strLength = str.length,
        str = str.trim().split('\n')[0];
    
    if (FUNC_STATEMENT_REGEXP.exec(str)) {
        return {
            name: RegExp.$1,
            string: RegExp.$1 + '()',
            type: FUNC_CODE_TYPE
        };
        
    } else if (FUNC_EXPRESSION_REGEXP.exec(str)) {
        return {
            name: RegExp.$1,
            string: RegExp.$1 + '()',
            type: FUNC_CODE_TYPE
        };
        
    } else if (PROTOTYPE_METHOD_REGEXP.exec(str)) {
        return {
            name: RegExp.$2,
            scope: {
                owner: RegExp.$1,
                type: 'instance'
            },
            string: RegExp.$1 + '.prototype.' + RegExp.$2 + '()',
            type: METHOD_CODE_TYPE
        };
        
    } else if (PROTOTYPE_PROPERTY_REGEXP.exec(str)) {
        return {
            name: RegExp.$2,
            scope: {
                owner: RegExp.$1,
                type: 'instance'
            },
            string: RegExp.$1 + '.prototype.' + RegExp.$2,
            type: PROPERTY_CODE_TYPE,
            value: RegExp.$3
        };
        
    } else if (METHOD_REGEXP.exec(str)) {
        return {
            name: RegExp.$2,
            scope: {
                owner: RegExp.$1,
                type: 'class'
            },
            string: RegExp.$1 + '.' + RegExp.$2 + '()',
            type: METHOD_CODE_TYPE
        };
        
    } else if (SCOPED_METHOD_REGEXP.exec(str)) {
        var scope = getScopeConstructor(position - strLength, constructors);
    
        return {
            name: RegExp.$1,
            scope: {
                owner: scope,
                type: 'instance'
            },
            string: scope + '.' + RegExp.$1 + '()',
            type: METHOD_CODE_TYPE
        };
        
    } else if (PROPERTY_REGEXP.exec(str)) {
        return {
            name: RegExp.$2,
            scope: {
                owner: RegExp.$1,
                type: 'class'
            },
            string: RegExp.$1 + '.' + RegExp.$2,
            type: PROPERTY_CODE_TYPE,
            value: RegExp.$3
        };

    } else if (SCOPED_PROPERTY_REGEXP.exec(str)) {
        var scope = getScopeConstructor(position - strLength, constructors);
    
        return {
            name: RegExp.$1,
            scope: {
                owner: scope,
                type: 'instance'
            },
            string: scope + '.' + RegExp.$1,
            type: PROPERTY_CODE_TYPE,
            value: RegExp.$2
        };

    } else if (DECLARATION_REGEXP.exec(str)) {
        return {
            name: RegExp.$1,
            string: RegExp.$1,
            type: DECLARATION_CODE_TYPE,
            value: RegExp.$2
        };
    }
};
