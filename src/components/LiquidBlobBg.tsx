import React from 'react';
import { StyleSheet, View } from 'react-native';

export function LiquidBlobBg() {
  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      <View style={{
        position: 'absolute', top: -44, right: -28,
        width: 190, height: 190, borderRadius: 95,
        backgroundColor: 'rgba(255,255,255,0.13)',
      }} />
      <View style={{
        position: 'absolute', bottom: -28, left: -22,
        width: 130, height: 130, borderRadius: 65,
        backgroundColor: 'rgba(255,255,255,0.09)',
      }} />
      <View style={{
        position: 'absolute', top: '35%', left: 24,
        width: 68, height: 68, borderRadius: 34,
        backgroundColor: 'rgba(255,255,255,0.06)',
      }} />
    </View>
  );
}
