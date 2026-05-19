import React, { useMemo } from 'react';
import { Text, type TextStyle, type StyleProp } from 'react-native';
import { tokenizeText } from '../utils/textTokens';

type Props = {
  text: string;
  style?: StyleProp<TextStyle>;
  linkStyle?: StyleProp<TextStyle>;
  numberOfLines?: number;
  onPressHashtag?: (tag: string) => void;
  /** Called with the raw @handle (no '@'). Resolution to a UID happens upstream. */
  onPressMention?: (handle: string) => void;
};

/**
 * Renders a single Text element with #hashtags and @mentions styled as links.
 * Keeps the surrounding spaces/newlines intact so the visual flow matches what
 * the user typed.
 */
export function RichText({ text, style, linkStyle, numberOfLines, onPressHashtag, onPressMention }: Props) {
  const tokens = useMemo(() => tokenizeText(text), [text]);

  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {tokens.map((tok, i) => {
        if (tok.kind === 'text') return <Text key={i}>{tok.value}</Text>;
        if (tok.kind === 'hashtag') {
          return (
            <Text
              key={i}
              style={linkStyle}
              onPress={onPressHashtag ? () => onPressHashtag(tok.tag) : undefined}
              suppressHighlighting
            >
              {tok.raw}
            </Text>
          );
        }
        return (
          <Text
            key={i}
            style={linkStyle}
            onPress={onPressMention ? () => onPressMention(tok.handle) : undefined}
            suppressHighlighting
          >
            {tok.raw}
          </Text>
        );
      })}
    </Text>
  );
}
