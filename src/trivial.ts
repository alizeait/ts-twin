import { collectParamNames } from './patterns';
import { isAstRecord, readArray } from './shared';
import type { AstRecord } from './types';

type TrivialExpressionCheck = (
  expression: unknown,
  params: Set<string>,
) => boolean;

export function isTrivialValueBuilder(node: AstRecord): boolean {
  return isTrivialSingleReturn(node, isTrivialValueExpression);
}

export function isTrivialJsxWrapper(node: AstRecord): boolean {
  return isTrivialSingleReturn(node, isTrivialJsxExpression);
}

export function isTrivialCallAdapter(node: AstRecord): boolean {
  const expression = getSingleExpression(node);
  const call = getCallExpression(expression);
  if (!call) return false;

  const params = new Set(collectParamNames(node));
  return (
    !isParamMemberRoot(call.callee, params) &&
    readArray(call.arguments).every((argument) =>
      isSimpleForwardedArgument(argument, params),
    )
  );
}

function isTrivialSingleReturn(
  node: AstRecord,
  isTrivialExpression: TrivialExpressionCheck,
): boolean {
  const expression = getSingleReturnExpression(node);
  if (!expression) return false;

  const params = new Set(collectParamNames(node));
  return (
    params.size > 0 &&
    isTrivialExpression(expression, params) &&
    referencesParam(expression, params)
  );
}

function getSingleReturnExpression(node: AstRecord): unknown {
  if (!isAstRecord(node.body)) return undefined;
  if (node.body.type !== 'BlockStatement') return node.body;

  const body = readArray(node.body.body);
  if (body.length !== 1 || !isAstRecord(body[0])) return undefined;
  return body[0].type === 'ReturnStatement' ? body[0].argument : undefined;
}

function getSingleExpression(node: AstRecord): unknown {
  if (!isAstRecord(node.body)) return undefined;
  if (node.body.type !== 'BlockStatement') return node.body;

  const body = readArray(node.body.body);
  if (body.length !== 1 || !isAstRecord(body[0])) return undefined;
  if (body[0].type === 'ReturnStatement') return body[0].argument;
  if (body[0].type === 'ExpressionStatement') return body[0].expression;
  return undefined;
}

function isTrivialValueExpression(
  value: unknown,
  params: Set<string>,
): boolean {
  const expression = unwrapExpression(value);
  if (!isAstRecord(expression)) return false;

  if (expression.type === 'Identifier') {
    return typeof expression.name === 'string' && params.has(expression.name);
  }

  if (expression.type === 'Literal') return true;
  if (expression.type === 'TemplateLiteral')
    return isTrivialTemplate(expression, params);
  if (expression.type === 'BinaryExpression')
    return isTrivialBinary(expression, params);
  if (expression.type === 'MemberExpression')
    return isTrivialMember(expression, params);

  return false;
}

function isTrivialTemplate(node: AstRecord, params: Set<string>): boolean {
  return readArray(node.expressions).every((expression) =>
    isTrivialValueExpression(expression, params),
  );
}

function isTrivialBinary(node: AstRecord, params: Set<string>): boolean {
  return (
    node.operator === '+' &&
    isTrivialValueExpression(node.left, params) &&
    isTrivialValueExpression(node.right, params)
  );
}

function isTrivialMember(node: AstRecord, params: Set<string>): boolean {
  if (!isParamMemberRoot(node.object, params)) return false;
  if (node.computed) return isTrivialValueExpression(node.property, params);
  return isAstRecord(node.property) && isSimpleProperty(node.property);
}

function isParamMemberRoot(value: unknown, params: Set<string>): boolean {
  const expression = unwrapExpression(value);
  if (!isAstRecord(expression)) return false;
  if (expression.type === 'Identifier') {
    return typeof expression.name === 'string' && params.has(expression.name);
  }
  return expression.type === 'MemberExpression'
    ? isParamMemberRoot(expression.object, params)
    : false;
}

function isSimpleProperty(node: AstRecord): boolean {
  return (
    node.type === 'Identifier' ||
    node.type === 'PrivateIdentifier' ||
    node.type === 'Literal'
  );
}

function getCallExpression(value: unknown): AstRecord | undefined {
  const expression = unwrapExpression(value);
  if (!isAstRecord(expression)) return undefined;
  if (expression.type === 'AwaitExpression')
    return getCallExpression(expression.argument);
  return expression.type === 'CallExpression' ? expression : undefined;
}

function isSimpleForwardedArgument(
  value: unknown,
  params: Set<string>,
): boolean {
  const expression = unwrapExpression(value);
  if (!isAstRecord(expression)) return false;
  if (expression.type === 'SpreadElement')
    return isSimpleForwardedArgument(expression.argument, params);
  if (expression.type === 'Literal') return true;
  if (expression.type === 'Identifier')
    return typeof expression.name === 'string' && params.has(expression.name);
  if (expression.type === 'MemberExpression')
    return isParamMemberRoot(expression.object, params);
  return false;
}

function referencesParam(value: unknown, params: Set<string>): boolean {
  const expression = unwrapExpression(value);
  if (!isAstRecord(expression)) return false;
  if (expression.type === 'Identifier') {
    return typeof expression.name === 'string' && params.has(expression.name);
  }
  if (expression.type === 'TemplateLiteral') {
    return readArray(expression.expressions).some((item) =>
      referencesParam(item, params),
    );
  }
  if (expression.type === 'BinaryExpression') {
    return (
      referencesParam(expression.left, params) ||
      referencesParam(expression.right, params)
    );
  }
  if (expression.type === 'MemberExpression') {
    return (
      referencesParam(expression.object, params) ||
      referencesParam(expression.property, params)
    );
  }
  if (isJsxNode(expression)) return jsxReferencesParam(expression, params);

  return false;
}

function isJsxNode(node: AstRecord): boolean {
  return node.type.startsWith('JSX');
}

function jsxReferencesParam(node: AstRecord, params: Set<string>): boolean {
  if (node.type === 'JSXElement') {
    const openingElement = node.openingElement;
    if (!isAstRecord(openingElement)) return false;

    return (
      readArray(openingElement.attributes).some((item) =>
        referencesParam(item, params),
      ) ||
      readArray(node.children).some((item) => referencesParam(item, params))
    );
  }
  if (node.type === 'JSXFragment') {
    return readArray(node.children).some((item) =>
      referencesParam(item, params),
    );
  }
  if (node.type === 'JSXAttribute') {
    return referencesParam(node.value, params);
  }
  if (node.type === 'JSXSpreadAttribute') {
    return referencesParam(node.argument, params);
  }
  if (node.type === 'JSXExpressionContainer') {
    return referencesParam(node.expression, params);
  }
  return false;
}

function isTrivialJsxExpression(value: unknown, params: Set<string>): boolean {
  const expression = unwrapExpression(value);
  if (!isAstRecord(expression)) return false;

  if (expression.type === 'JSXElement')
    return isTrivialJsxElement(expression, params);
  if (expression.type === 'JSXFragment') {
    return readArray(expression.children).every((child) =>
      isTrivialJsxChild(child, params),
    );
  }

  return false;
}

function isTrivialJsxElement(node: AstRecord, params: Set<string>): boolean {
  if (!isAstRecord(node.openingElement)) return false;

  return (
    readArray(node.openingElement.attributes).every((attribute) =>
      isTrivialJsxAttribute(attribute, params),
    ) &&
    readArray(node.children).every((child) => isTrivialJsxChild(child, params))
  );
}

function isTrivialJsxAttribute(
  attribute: unknown,
  params: Set<string>,
): boolean {
  if (!isAstRecord(attribute)) return false;
  if (attribute.type === 'JSXSpreadAttribute') {
    return isTrivialForwardedExpression(attribute.argument, params);
  }
  if (attribute.type !== 'JSXAttribute') return false;
  if (attribute.value === null) return true;
  if (isLiteral(attribute.value)) return true;

  return (
    isAstRecord(attribute.value) &&
    attribute.value.type === 'JSXExpressionContainer' &&
    isTrivialForwardedExpression(attribute.value.expression, params)
  );
}

function isTrivialJsxChild(child: unknown, params: Set<string>): boolean {
  if (!isAstRecord(child)) return false;
  if (child.type === 'JSXText') return isWhitespaceText(child.value);
  if (child.type === 'JSXElement' || child.type === 'JSXFragment') {
    return isTrivialJsxExpression(child, params);
  }
  return (
    child.type === 'JSXExpressionContainer' &&
    isTrivialForwardedExpression(child.expression, params)
  );
}

function isTrivialForwardedExpression(
  value: unknown,
  params: Set<string>,
): boolean {
  const expression = unwrapExpression(value);
  if (!isAstRecord(expression)) return false;
  if (expression.type === 'Identifier') {
    return typeof expression.name === 'string' && params.has(expression.name);
  }
  if (expression.type === 'MemberExpression')
    return isTrivialMember(expression, params);
  return false;
}

function isLiteral(value: unknown): boolean {
  return isAstRecord(value) && value.type === 'Literal';
}

function isWhitespaceText(value: unknown): boolean {
  return typeof value === 'string' && value.trim() === '';
}

function unwrapExpression(value: unknown): unknown {
  if (!isAstRecord(value)) return value;
  if (
    value.type === 'ChainExpression' ||
    value.type === 'ParenthesizedExpression' ||
    value.type === 'TSAsExpression' ||
    value.type === 'TSNonNullExpression' ||
    value.type === 'TSTypeAssertion'
  ) {
    return unwrapExpression(value.expression);
  }
  return value;
}
