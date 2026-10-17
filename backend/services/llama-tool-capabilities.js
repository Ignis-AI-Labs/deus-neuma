/**
 * Interpret the serving template's tool support without guessing from model names.
 * Explicit refusal wins; absent declarations leave legacy inference unchanged.
 * @param {{chat_template_caps?: Object}} props
 * @returns {{tools?: boolean}}
 */
export const llamaToolCapabilities = (props) => {
  const caps = props?.chat_template_caps;
  if (caps?.supports_tools === false || caps?.supports_tool_calls === false) {
    return Object.freeze({ tools: false });
  }
  return Object.freeze(caps?.supports_tools === true ? { tools: true } : {});
};
