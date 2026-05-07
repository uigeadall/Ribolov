import React, { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { PlatformPressable } from '@react-navigation/elements';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../services/themeContext';
import {
  FeedStackParamList,
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
import SearchScreen from '../screens/SearchScreen';
import PersonalBestsScreen from '../screens/PersonalBestsScreen';
import GroupsScreen from '../screens/GroupsScreen';
import GroupDetailScreen from '../screens/GroupDetailScreen';
import CreateGroupScreen from '../screens/CreateGroupScreen';
import ExploreScreen from '../screens/ExploreScreen';

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
const FeedStack = createNativeStackNavigator<FeedStackParamList>();
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

function FeedNavigator() {
  return (
    <FeedStack.Navigator screenOptions={{ headerShown: false }}>
      <FeedStack.Screen name="FeedList" component={FeedScreenWrapped} />
      <FeedStack.Screen name="Classics" component={ClassicsScreenWrapped} />
      <FeedStack.Screen name="SavedPosts" component={SavedPostsWrapped} />
      <FeedStack.Screen name="Notifications" component={NotificationsWrapped} />
      <FeedStack.Screen name="Auth" component={AuthScreenWrapped} />
      <FeedStack.Screen name="Friends" component={FriendsScreenWrapped} />
      <FeedStack.Screen name="Explore" component={ExploreScreen} />
    </FeedStack.Navigator>
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
      <ProfileStack.Screen name="Species" component={SpeciesNavigator} />
      <ProfileStack.Screen name="PersonalBests" component={PersonalBestsScreen} />
      <ProfileStack.Screen name="Groups" component={GroupsScreen} />
      <ProfileStack.Screen name="GroupDetail" component={GroupDetailScreen} />
      <ProfileStack.Screen name="CreateGroup" component={CreateGroupScreen} />
    </ProfileStack.Navigator>
  );
}

function TabNavigator() {
  const { colors, mode } = useTheme();
  const insets = useSafeAreaInsets();
  /** По-малък ред за икона+етикет от стандартните ~49px; отделно се добавя само долният inset. */
  const tabRowInner = 34;
  const tabPadTop = 2;
  /** По-малко от пълния insets.bottom (~34px) — по-близо до долния ръб без двойно приложен inset от навигатора */
  const rawBottom = insets.bottom;
  const bottomPad =
    rawBottom <= 0 ? 6 : Math.max(7, Math.min(12, Math.round(rawBottom * 0.28 + 5)));

  const tabBarStyle = useMemo(
    () => ({
      backgroundColor: colors.card,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      elevation: 12,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -2 },
      shadowOpacity: mode === 'dark' ? 0.28 : 0.06,
      shadowRadius: 10,
      paddingTop: tabPadTop,
      paddingBottom: bottomPad,
      height: tabPadTop + tabRowInner + bottomPad,
    }),
    [colors.border, colors.card, mode, bottomPad]
  );

  return (
    // bottom safe area за табовете контролираме само чрез tabBarStyle.paddingBottom — без втори пълен inset от навигатора
    <Tabs.Navigator
      safeAreaInsets={{ bottom: 0 }}
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle,
        tabBarButton: (props) => (
          <PlatformPressable
            {...props}
            style={[props.style, { justifyContent: 'center', paddingVertical: 2 }]}
          />
        ),
        tabBarLabelStyle: {
          fontSize: 9,
          fontWeight: '600',
          letterSpacing: 0.2,
          marginBottom: 0,
          marginTop: 1,
        },
        tabBarIcon: ({ color, focused }) => {
          const iconSize = 22;
          let icon: keyof typeof Ionicons.glyphMap = 'home';
          if (route.name === 'HomeTab') icon = focused ? 'home' : 'home-outline';
          if (route.name === 'LogbookTab') icon = focused ? 'book' : 'book-outline';
          if (route.name === 'MapTab') icon = focused ? 'map' : 'map-outline';
          if (route.name === 'FeedTab') icon = focused ? 'newspaper' : 'newspaper-outline';
          if (route.name === 'ProfileTab') icon = focused ? 'person' : 'person-outline';
          return <Ionicons name={icon} size={iconSize} color={color} />;
        },
      })}
    >
      <Tabs.Screen name="HomeTab" component={HomeScreen} options={{ title: 'Начало' }} />
      <Tabs.Screen name="LogbookTab" component={LogbookNavigator} options={{ title: 'Дневник' }} />
      <Tabs.Screen name="MapTab" component={MapScreenWrapped} options={{ title: 'Карта' }} />
      <Tabs.Screen name="FeedTab" component={FeedNavigator} options={{ title: 'Лента' }} />
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
        <RootStack.Screen
          name="Search"
          component={SearchScreen}
          options={{ presentation: 'modal' }}
        />
      </RootStack.Navigator>
    </NavigationContainer>
  );
}
