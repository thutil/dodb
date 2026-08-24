cask "dodb" do
  version "0.2.4"
  sha256 "88d3a9298247e9e9f9cc4d835523698b157fe7c1f57587873b4910d5cc7622f3"

  url "https://github.com/thutil/dodb/releases/download/v#{version}/dodb_#{version}_universal.dmg"
  name "dodb"
  desc "Modern Multi-Platform Database Manager for Postgres, MySQL, MariaDB & SQLite"
  homepage "https://github.com/thutil/dodb"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true
  depends_on macos: ">= :big_sur"

  app "dodb.app"

  zap trash: [
    "~/Library/Application Support/com.thutil.dodb",
    "~/Library/Caches/com.thutil.dodb",
    "~/Library/Preferences/com.thutil.dodb.plist",
    "~/Library/Saved Application State/com.thutil.dodb.savedState",
    "~/Library/WebKit/com.thutil.dodb",
  ]
end
