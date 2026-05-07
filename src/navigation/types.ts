import type { NavigatorScreenParams } from '@react-navigation/native';

export type LogbookStackParamList = {
  LogbookList: undefined;
  AddCatch:
    | {
        prefillLocation?: { latitude: number; longitude: number; name: string };
        editCatchId?: string;
      }
    | undefined;
  CatchDetail: { id: string };
};

export type SpeciesStackParamList = {
  SpeciesList: undefined;
  SpeciesDetail: { id: string };
  Regulations: undefined;
  Gear: undefined;
  Knots: undefined;
  KnotDetail: { id: string };
  WeightCalc: undefined;
};

export type ProfileStackParamList = {
  ProfileMain: undefined;
  Species: NavigatorScreenParams<SpeciesStackParamList>;
  PersonalBests: undefined;
  Groups: undefined;
  GroupDetail: { groupId: string; groupName: string };
  CreateGroup: undefined;
  Notifications: undefined;
  Stats: undefined;
  Auth: undefined;
  Feed: undefined;
  SavedPosts: undefined;
  Friends: undefined;
  Tournaments: undefined;
  TournamentDetail: { id: string };
  CreateTournament: undefined;
  Achievements: undefined;
  Trips: undefined;
  TripDetail: { id: string };
  Insights: undefined;
  Leaderboard: { damId?: string; riverId?: string } | undefined;
  Classics: undefined;
  Chats: undefined;
  ChatDetail: { convId: string; otherUid: string; otherName: string };
  LegalInfo: undefined;
};

export type FeedStackParamList = {
  FeedList: undefined;
  Classics: undefined;
  SavedPosts: undefined;
  Notifications: undefined;
  Auth: undefined;
  Friends: undefined;
  Explore: undefined;
};


export type TabsParamList = {
  HomeTab: undefined;
  LogbookTab: NavigatorScreenParams<LogbookStackParamList>;
  MapTab: { focusDamId?: string; focusRiverId?: string } | undefined;
  FeedTab: NavigatorScreenParams<FeedStackParamList>;
  ProfileTab: NavigatorScreenParams<ProfileStackParamList>;
};

export type RootStackParamList = {
  Main: NavigatorScreenParams<TabsParamList>;
  /** photoUrlHint — локален URI или последно известен remote URL за мигновен преглед, докато Firestore се синхронизира */
  UserPublicProfile: { uid: string; displayName?: string; photoUrlHint?: string };
  Search: undefined;
};
