import React, { useRef } from 'react';
import { Animated, Pressable, StyleSheet, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

type Props = PressableProps & {
  style?: StyleProp<ViewStyle>;
  scaleValue?: number;
  children?: React.ReactNode;
};

export function ScalePressable({ style, scaleValue = 0.96, children, ...props }: Props) {
  const scale = useRef(new Animated.Value(1)).current;

  const pressIn = () =>
    Animated.spring(scale, { toValue: scaleValue, useNativeDriver: true, speed: 50, bounciness: 0 }).start();
  const pressOut = () =>
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 40, bounciness: 4 }).start();

  const flat = (StyleSheet.flatten(style) ?? {}) as ViewStyle;

  // Layout props on the outer Pressable so flex/margin work correctly in parent containers
  const pressableStyle: ViewStyle = {
    flex: flat.flex,
    flexGrow: flat.flexGrow,
    flexShrink: flat.flexShrink,
    alignSelf: flat.alignSelf,
    width: flat.width,
    height: flat.height,
    margin: flat.margin,
    marginHorizontal: flat.marginHorizontal,
    marginVertical: flat.marginVertical,
    marginTop: flat.marginTop,
    marginBottom: flat.marginBottom,
    marginLeft: flat.marginLeft,
    marginRight: flat.marginRight,
  };

  // Visual + content-layout props on the inner Animated.View — strip margin/flex so they don't double-apply
  const { flex: _f, flexGrow: _fg, flexShrink: _fs, alignSelf: _as, width: _w,
    margin: _m, marginHorizontal: _mh, marginVertical: _mv,
    marginTop: _mt, marginBottom: _mb, marginLeft: _ml, marginRight: _mr,
    ...animatedStyle } = flat;

  return (
    <Pressable style={pressableStyle} onPressIn={pressIn} onPressOut={pressOut} {...props}>
      <Animated.View style={[animatedStyle, { transform: [{ scale }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
