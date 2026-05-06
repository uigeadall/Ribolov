import React, { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../services/themeContext';
import {
  LogbookStackParamList,
  ProfileStackParamList,
  RootStackParamList,
  SpeciesStackParamList,
  TabsParamList,
} from './types';

import HomeScreen from '../screens/HomeScreen';
import LogbookScreen from '../screens/LogbookScreen';
import AddCatchScreen from '../screens/AddCatchScreen';
import CatchDetailScreen from '../screens/CatchDetailScreen';
import MapScreen from '../screens/MapScreen';
import SpeciesScreen from '../screens/SpeciesScreen';
import SpeciesDetailScreen from '../screens/SpeciesDetailScreen';
import RegulationsScreen from '../screens/RegulationsScreen';
import GearScreen from '../screens/GearScreen';
import ProfileScreen from '../screens/ProfileScreen';
import StatsScreen from '../screens/StatsScreen';
import AuthScreen from '../screens/AuthScreen';
import FeedScreen from '../screens/FeedScreen';
import FriendsScreen from '../screens/FriendsScreen';
import TournamentsScreen from '../screens/TournamentsScreen';
import TournamentDetailScreen from '../screens/TournamentDetailScreen';
import CreateTournamentScreen from '../screens/CreateTournamentScreen';
import AchievementsScreen from '../screens/AchievementsScreen';
import KnotsScreen from '../screens/KnotsScreen';
import KnotDetailScreen from '../screens/KnotDetailScreen';
import WeightCalcScreen from '../screens/WeightCalcScreen';
import TripsScreen from '../screens/TripsScreen';
import TripDetailScreen from '../screens/TripDetailScreen';
import InsightsScreen from '../screens/InsightsScreen';
import ClassicsScreen from '../screens/ClassicsScreen';
import ChatsScreen from '../screens/ChatsScreen';
import ChatDetailScreen from '../screens/ChatDetailScreen';
import LegalInfoScreen from '../screens/LegalInfoScreen';
import LeaderboardScreen from '../screens/LeaderboardScreen';
import UserPublicProfileScreen from '../screens/UserPublicProfileScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import SavedPostsScreen from '../screens/SavedPostsScreen';
import { ErrorBoundary } from '../components/ErrorBoundary';

const wrap = (label: string, Component: React.ComponentType<any>) => (props: any) =>
  (
    <ErrorBoundary label={label}>
      <Component {...props} />
    </ErrorBoundary>
  );

const MapScreenWrapped = wrap('Карта', MapScreen);
const AuthScreenWrapped = wrap('Вход', AuthScreen);
const FeedScreenWrapped = wrap('Feed', FeedScreen);
const FriendsScreenWrapped = wrap('Приятели', FriendsScreen);
const LeaderboardScreenWrapped = wrap('Класирания', LeaderboardScreen);
const ClassicsScreenWrapped = wrap('Класики', ClassicsScreen);
const UserPublicProfileWrapped = wrap('Профил на рибар', UserPublicProfileScreen);
const NotificationsWrapped = wrap('Известия', NotificationsScreen);
const SavedPostsWrapped = wrap('Запазени', SavedPostsScreen);

const Tabs = createBottomTabNavigator<TabsParamList>();
const LogbookStack = createNativeStackNavigator<LogbookStackParamList>();
const SpeciesStack = createNativeStackNavigator<SpeciesStackParamList>();
const ProfileStack = createNativeStackNavigator<ProfileStackParamList>();
const RootStack = createNativeStackNavigator<RootStackParamList>();

function LogbookNavigator() {
  return (
    <LogbookStack.Navigator screenOptions={{ headerShown: false }}>
      <LogbookStack.Screen name="LogbookList" component={LogbookScreen} />
      <LogbookStack.Screen name="AddCatch" component={AddCatchScreen} />
      <LogbookStack.Screen name="CatchDetail" component={CatchDetailScreen} />
    </LogbookStack.Navigator>
  );
}

function SpeciesNavigator() {
  return (
    <SpeciesStack.Navigator screenOptions={{ headerShown: false }}>
      <SpeciesStack.Screen name="SpeciesList" component={SpeciesScreen} />
      <SpeciesStack.Screen name="SpeciesDetail" component={SpeciesDetailScreen} />
      <SpeciesStack.Screen name="Regulations" component={RegulationsScreen} />
      <SpeciesStack.Screen name="Gear" component={GearScreen} />
      <SpeciesStack.Screen name="Knots" component={KnotsScreen} />
      <SpeciesStack.Screen name="KnotDetail" component={KnotDetailScreen} />
      <SpeciesStack.Screen name="WeightCalc" component={WeightCalcScreen} />
    </SpeciesStack.Navigator>
  );
}

function ProfileNavigator() {
  return (
    <ProfileStack.Navigator screenOptions={{ headerShown: false }}>
      <ProfileStack.Screen name="ProfileMain" component={ProfileScreen} />
      <ProfileStack.Screen name="Notifications" component={NotificationsWrapped} />
      <ProfileStack.Screen name="Stats" component={StatsScreen} />
      <ProfileStack.Screen name="Auth" component={AuthScreenWrapped} />
      <ProfileStack.Screen name="Feed" component={FeedScreenWrapped} />
      <ProfileStack.Screen name="SavedPosts" component={SavedPostsWrapped} />
      <ProfileStack.Screen name="Friends" component={FriendsScreenWrapped} />
      <ProfileStack.Screen name="Tournaments" component={TournamentsScreen} />
      <ProfileStack.Screen name="TournamentDetail" component={TournamentDetailScreen} />
      <ProfileStack.Screen name="CreateTournament" component={CreateTournamentScreen} />
      <ProfileStack.Screen name="Achievements" component={AchievementsScreen} />
      <ProfileStack.Screen name="Trips" component={TripsScreen} />
      <ProfileStack.Screen name="TripDetail" component={TripDetailScreen} />
      <ProfileStack.Screen name="Insights" component={InsightsScreen} />
      <ProfileStack.Screen name="Leaderboard" component={LeaderboardScreenWrapped} />
      <ProfileStack.Screen name="Classics" component={ClassicsScreenWrapped} />
      <ProfileStack.Screen name="Chats" component={ChatsScreen} />
      <ProfileStack.Screen name="ChatDetail" component={ChatDetailScreen} />
      <ProfileStack.Screen name="LegalInfo" component={LegalInfoScreen} />
    </ProfileStack.Navigator>
  );
}

function TabNavigator() {
  const { colors, mode } = useTheme();
  return (
    <Tabs.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.border,
          paddingTop: 8,
          paddingBottom: 10,
          height: 64,
          elevation: 12,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: mode === 'dark' ? 0.28 : 0.06,
          shadowRadius: 10,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700', letterSpacing: 0.35, marginBottom: 2 },
        tabBarIcon: ({ color, size }) => {
          let icon: keyof typeof Ionicons.glyphMap = 'home';
          if (route.name === 'HomeTab') icon = 'home-outline';
          if (route.name === 'LogbookTab') icon = 'book-outline';
          if (route.name === 'MapTab') icon = 'map-outline';
          if (route.name === 'SpeciesTab') icon = 'fish-outline';
          if (route.name === 'ProfileTab') icon = 'person-outline';
          return <Ionicons name={icon} size={size} color={color} />;
        },
      })}
    >
      <Tabs.Screen name="HomeTab" component={HomeScreen} options={{ title: 'Начало' }} />
      <Tabs.Screen name="LogbookTab" component={LogbookNavigator} options={{ title: 'Дневник' }} />
      <Tabs.Screen name="MapTab" component={MapScreenWrapped} options={{ title: 'Карта' }} />
      <Tabs.Screen name="SpeciesTab" component={SpeciesNavigator} options={{ title: 'Видове' }} />
      <Tabs.Screen name="ProfileTab" component={ProfileNavigator} options={{ title: 'Профил' }} />
    </Tabs.Navigator>
  );
}

export function RootNavigator() {
  const { colors, mode } = useTheme();
  const navTheme = useMemo(
    () => ({
      ...DefaultTheme,
      dark: mode === 'dark',
      colors: {
        ...DefaultTheme.colors,
        background: colors.background,
        card: colors.card,
        text: colors.text,
        border: colors.border,
        primary: colors.primary,
      },
    }),
    [colors, mode]
  );

  return (
    <NavigationContainer theme={navTheme}>
      <RootStack.Navigator screenOptions={{ headerShown: false }}>
        <RootStack.Screen name="Main" component={TabNavigator} />
        <RootStack.Screen name="UserPublicProfile" component={UserPublicProfileWrapped} />
      </RootStack.Navigator>
    </NavigationContainer>
  );
}
