
/**
 * Escape the given `html`.
 *
 * @param {String} html
 * @return {String}
 * @api private
 */

exports.escape = function(html){
  return String(html)
    .replace(/&(?!\w+;)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
};

var CONSTRUCTOR_INDENTATION = '^[ ]*';

var CONSTRUCTOR_BLOCKS = [
    {
        start: '(.*).prototype = {',
        end: '};'
    },
    {
        start: '_.extend\\((.*).prototype, {',
        end: '}\\);'
    }
];


/**
 * Parses a given js code in look for possible blocks 
 * that could contain method and properties declarations
 */
exports.parseConstructorBlocks = function(js) {
    var constructorsMap = [];
    
    CONSTRUCTOR_BLOCKS.forEach(
        function (constructor) {
            var startRegexp = new RegExp(CONSTRUCTOR_INDENTATION + constructor.start, 'gm'),
                endRegexp = new RegExp(CONSTRUCTOR_INDENTATION + constructor.end, 'gm'),
                match;
            
            while ((match = startRegexp.exec(js)) !== null) {
                var indentation = match[0].match(/^\s+/)[0].length,
                    start = match.index,
                    end = start + match[0].length,
                    rest = js.substr(start),
                    endMatch;
                
                while ((endMatch = endRegexp.exec(rest)) !== null) {
                    if (endMatch[0].match(/^\s+/)[0].length === indentation) {
                        end = start + endMatch.index + endMatch[0].length;
                        break;
                    }
                }
                
                endRegexp.lastIndex = 0;
                
                constructorsMap.push(
                    {
                        name: match[1],
                        start: start,
                        end: end
                    }
                );
            }
        }
    );
    
    return constructorsMap;
};

/**
 * Determines if the index position is within the scope of
 * a constructor
 */
exports.getScopeConstructor = function(index, constructors) {
  var constructor = null,
      constructorsLength = constructors.length,
      i;
  
  for (i = 0; i < constructorsLength; i++) {
    constructor = constructors[i];
    
    if (constructor.start <= index && index <= constructor.end) {
      break;
    }
    
    constructor = null;
  }
  
  return constructor ? constructor.name : null;
};